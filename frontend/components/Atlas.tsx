"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ask, fetchExplain, fetchLevel, fetchRepo, fetchSummary, type AskEvent, type Explain, type Level, type Snapshot } from "@/lib/api";
import { langColor } from "@/lib/colors";
import { buildGraph, shortNumber } from "@/lib/graph";
import type { Box } from "@/lib/layout";
import Diagram from "./Diagram";
import { ArrowUp, ChevronLeft, Close, External, Logo, Sparkle, Star } from "./Icons";
import Markdown from "./Markdown";

type Step = { name: string; args: Record<string, unknown>; files: string[] };
type Msg = { role: "user"; content: string } | { role: "assistant"; content: string; files: string[]; steps: Step[]; error?: boolean };

const STAGES = ["Finding the repo", "Downloading the code", "Reading the imports", "Drawing the diagram"];
const SUGGESTIONS = ["Where does the app start?", "How do the main parts work together?", "Where would I add a new feature?"];

function readPath(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("path") || "";
}

export default function Atlas({ slug }: { slug: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState(0);
  const [path, setPath] = useState("");
  const [level, setLevel] = useState<Level | null>(null);
  const [levelError, setLevelError] = useState("");
  const [explain, setExplain] = useState<Explain | null>(null);
  const [explainError, setExplainError] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"explain" | "ask">("explain");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [litPaths, setLitPaths] = useState<string[] | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  // --------------------------------------------------------------- loading

  useEffect(() => {
    let alive = true;
    setSnapshot(null);
    setError("");
    setStage(0);
    setPath(readPath());
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 1500);
    fetchRepo(slug)
      .then((s) => alive && setSnapshot(s))
      .catch((e) => alive && setError(e.message))
      .finally(() => clearInterval(timer));
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [slug]);

  const graph = useMemo(() => (snapshot ? buildGraph(snapshot) : null), [snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    let alive = true;
    setLevelError("");
    setSelected(null);
    setExplainError("");
    fetchLevel(snapshot.slug, snapshot.sha, path)
      .then((lv) => {
        if (!alive) return;
        setLevel(lv);
        setExplain(lv.explain);
        if (!lv.explain) {
          fetchExplain(snapshot.slug, snapshot.sha, lv.path)
            .then((e) => alive && setExplain(e))
            .catch((e) => alive && setExplainError(e.message));
        }
      })
      .catch((e) => alive && setLevelError(e.message));
    return () => {
      alive = false;
    };
  }, [snapshot, path]);

  const go = useCallback((p: string) => {
    setPath(p);
    setLitPaths(null);
    const url = new URL(window.location.href);
    if (p) url.searchParams.set("path", p);
    else url.searchParams.delete("path");
    window.history.pushState(null, "", url);
  }, []);

  useEffect(() => {
    const onPop = () => setPath(readPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ------------------------------------------------------------- selection

  const loadSummary = useCallback(
    (filePath: string) => {
      if (!snapshot || summaries[filePath] !== undefined) return;
      setSummaries((s) => ({ ...s, [filePath]: "" }));
      fetchSummary(snapshot.slug, snapshot.sha, filePath)
        .then((text) => setSummaries((s) => ({ ...s, [filePath]: text })))
        .catch(() => setSummaries((s) => ({ ...s, [filePath]: "No summary right now." })));
    },
    [snapshot, summaries],
  );

  const open = (b: Box, k: number) => {
    if (b.kind === "folder" && selected === k) {
      go(b.target);
      return;
    }
    setSelected(k);
    setTab("explain");
    if (b.kind === "file") loadSummary(b.target);
  };

  // Boxes on this level that hold files the AI mentioned.
  const lit = useMemo(() => {
    if (!litPaths || !level || !graph) return null;
    const s = new Set<number>();
    level.boxes.forEach((b, k) => {
      const members = new Set(b.files);
      for (const p of litPaths) {
        const i = graph.index.get(p);
        if (i !== undefined ? members.has(i) : b.target && (b.target === p || b.target.startsWith(p) || p.startsWith(b.target))) s.add(k);
      }
    });
    return s.size ? s : null;
  }, [litPaths, level, graph]);

  // -------------------------------------------------------------------- ask

  const send = async (question: string) => {
    if (!snapshot || busy || question.trim().length < 2) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: question }, { role: "assistant", content: "", files: [], steps: [] }]);
    setDraft("");
    setBusy(true);
    const update = (fn: (m: Extract<Msg, { role: "assistant" }>) => Extract<Msg, { role: "assistant" }>) =>
      setMessages((all) => {
        const copy = [...all];
        const last = copy[copy.length - 1];
        if (last.role === "assistant") copy[copy.length - 1] = fn(last);
        return copy;
      });
    try {
      await ask(snapshot.slug, snapshot.sha, question, history, (e: AskEvent) => {
        if (e.type === "tool") update((m) => ({ ...m, steps: [...m.steps, { name: e.name, args: e.args, files: e.files }] }));
        else if (e.type === "answer") {
          update((m) => ({ ...m, content: e.text, files: e.files }));
          setLitPaths(e.files.length ? e.files : null);
        } else update((m) => ({ ...m, content: e.message, error: true }));
      });
    } catch (err) {
      update((m) => ({ ...m, content: (err as Error).message, error: true }));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages]);

  // Jump to the folder that holds a path and select it there.
  const showPath = (p: string) => {
    if (!snapshot) return;
    const folder = p.endsWith("/") ? p : p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "";
    setLitPaths([p]);
    if (folder !== level?.path) go(folder);
  };

  const codeSpan = (code: string, key: number) => {
    if (!snapshot || !graph) return <code key={key}>{code}</code>;
    const clean = code.replace(/^\.\//, "").replace(/:\d+(-\d+)?$/, "");
    const hit = graph.index.has(clean)
      ? clean
      : snapshot.files.find((f) => f.path.endsWith("/" + clean))?.path ??
        (snapshot.files.some((f) => f.path.startsWith(clean.replace(/\/?$/, "/"))) ? clean.replace(/\/?$/, "/") : null);
    if (!hit) return <code key={key}>{code}</code>;
    return (
      <button key={key} className="path-chip" onClick={() => showPath(hit)} title="Show it in the diagram">
        {code}
      </button>
    );
  };

  // ----------------------------------------------------------------- render

  if (error) {
    return (
      <div className="state">
        <Logo size={40} />
        <p className="state-title">Couldn&apos;t map {slug}</p>
        <p className="state-text">{error}</p>
        <Link href="/" className="btn primary">
          Try another repo
        </Link>
      </div>
    );
  }

  if (!snapshot || !graph) {
    return (
      <div className="state">
        <div className="spinner" aria-hidden />
        <p className="state-title">Mapping {slug}</p>
        <p className="state-text">{STAGES[stage]}…</p>
      </div>
    );
  }

  const github = `https://github.com/${snapshot.slug}`;
  const box = level && selected !== null ? level.boxes[selected] : null;
  const here = level?.crumbs[level.crumbs.length - 1];

  return (
    <div className="atlas">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Repo Atlas home">
          <Logo size={22} />
          <span>Repo Atlas</span>
        </Link>
        <div className="repo-meta">
          <a href={github} target="_blank" rel="noreferrer" className="repo-name">
            {snapshot.slug}
          </a>
          <span className="repo-stats">
            <Star size={12} /> {shortNumber(snapshot.stars || 0)} · {shortNumber(snapshot.totals.files)} files · {shortNumber(snapshot.totals.loc)} lines
          </span>
        </div>
      </header>

      <main className="canvas">
        {level && (
          <nav className="crumbs" aria-label="Folder">
            {level.crumbs.map((c, k) => (
              <span key={c.path}>
                {k > 0 && <span className="sep">/</span>}
                {k < level.crumbs.length - 1 ? <button onClick={() => go(c.path)}>{c.name}</button> : <strong>{c.name}</strong>}
              </span>
            ))}
          </nav>
        )}
        {levelError && <p className="state-text center">{levelError}</p>}
        {level && (
          <Diagram
            key={level.path}
            boxes={level.boxes}
            links={level.links}
            roles={explain?.boxes ?? (explainError ? {} : null)}
            start={explain?.start ?? ""}
            selected={selected}
            lit={lit}
            onOpen={open}
          />
        )}
        {level && (
          <p className="hint">
            Arrows point from a part to the parts it uses. Click a box for details, click a folder again to open it.
          </p>
        )}
      </main>

      <aside className="side">
        <div className="tabs" role="tablist">
          <button className={tab === "explain" ? "on" : ""} onClick={() => setTab("explain")}>
            Explain
          </button>
          <button className={tab === "ask" ? "on" : ""} onClick={() => setTab("ask")}>
            <Sparkle size={14} /> Ask
          </button>
        </div>

        {tab === "explain" && level && (
          <div className="side-body">
            {!box ? (
              <>
                <h2>{level.path ? here?.name + "/" : "What this repo is"}</h2>
                <p className="muted">
                  {level.boxes.length} parts · {shortNumber(level.boxes.reduce((a, b) => a + b.files.length, 0))} files
                </p>
                {explain ? (
                  <p className="summary">{explain.summary}</p>
                ) : explainError ? (
                  <p className="summary muted">{explainError}</p>
                ) : (
                  <p className="summary loading">Reading the code to explain it…</p>
                )}
                {explain?.start && (
                  <button
                    className="start-chip"
                    onClick={() => {
                      const k = level.boxes.findIndex((b) => b.name === explain.start);
                      if (k >= 0) open(level.boxes[k], k);
                    }}
                  >
                    Start with <strong>{explain.start}</strong>
                  </button>
                )}
                {level.links.length > 0 && (
                  <>
                    <h3>How the parts connect</h3>
                    <ul className="flows">
                      {level.links.slice(0, 6).map((l, k) => (
                        <li key={k}>
                          <strong>{level.boxes[l.from].name}</strong> uses <strong>{level.boxes[l.to].name}</strong>
                          <span> · {l.count} import{l.count === 1 ? "" : "s"}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <h3>Parts</h3>
                <ul className="parts">
                  {level.boxes.map((b, k) => (
                    <li key={b.id}>
                      <button onClick={() => open(b, k)}>
                        <i style={{ background: langColor(b.langs[0]?.lang || "Other") }} />
                        <span>
                          <strong>{b.kind === "folder" ? b.name + "/" : b.name}</strong>
                          <em>{explain?.boxes[b.name] || `${b.files.length} files`}</em>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <BoxDetails
                box={box}
                snapshot={snapshot}
                graph={graph}
                role={explain?.boxes[box.name]}
                summary={box.kind === "file" ? summaries[box.target] : undefined}
                github={github}
                onBack={() => setSelected(null)}
                onOpenFolder={() => go(box.target)}
                onShow={showPath}
              />
            )}
          </div>
        )}

        {tab === "ask" && (
          <>
            <div className="side-body chat">
              {messages.length === 0 && (
                <div className="suggest">
                  <p className="muted">Ask anything about this repo. The AI reads the code to answer and highlights the parts it talks about.</p>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {messages.map((m, k) =>
                m.role === "user" ? (
                  <div key={k} className="msg user">
                    {m.content}
                  </div>
                ) : (
                  <div key={k} className={`msg ai ${m.error ? "error" : ""}`}>
                    {m.steps.length > 0 && (
                      <ul className="steps">
                        {m.steps.map((s, j) => (
                          <li key={j}>{describeStep(s)}</li>
                        ))}
                      </ul>
                    )}
                    {m.content ? (
                      <Markdown text={m.content} code={codeSpan} />
                    ) : (
                      <p className="thinking">
                        <span />
                        <span />
                        <span />
                      </p>
                    )}
                  </div>
                ),
              )}
              <div ref={chatEnd} />
            </div>
            <form
              className="ask-input"
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
            >
              <textarea
                value={draft}
                rows={1}
                placeholder="How does this repo handle logins?"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(draft);
                  }
                }}
              />
              <button type="submit" disabled={busy || draft.trim().length < 2} aria-label="Send">
                <ArrowUp size={16} />
              </button>
            </form>
          </>
        )}
      </aside>
    </div>
  );
}

function BoxDetails({
  box,
  snapshot,
  graph,
  role,
  summary,
  github,
  onBack,
  onOpenFolder,
  onShow,
}: {
  box: Box;
  snapshot: Snapshot;
  graph: ReturnType<typeof buildGraph>;
  role?: string;
  summary?: string;
  github: string;
  onBack: () => void;
  onOpenFolder: () => void;
  onShow: (p: string) => void;
}) {
  const files = snapshot.files;
  const biggest = [...box.files].sort((a, b) => files[b].loc - files[a].loc).slice(0, 8);
  const fileIdx = box.kind === "file" ? box.files[0] : null;
  return (
    <>
      <button className="back" onClick={onBack}>
        <ChevronLeft size={14} /> Overview
      </button>
      <h2>{box.kind === "folder" ? box.name + "/" : box.name}</h2>
      <p className="muted">
        {box.files.length === 1 ? "1 file" : `${box.files.length} files`} · {box.loc.toLocaleString()} lines
        {box.langs.length > 0 && " · " + box.langs.map((l) => l.lang).join(", ")}
      </p>
      {box.kind === "file" ? (
        <p className={`summary ${summary ? "" : "loading"}`}>{summary || "Reading the file…"}</p>
      ) : (
        role && <p className="summary">{role}</p>
      )}
      {box.kind === "folder" && (
        <button className="btn primary wide" onClick={onOpenFolder}>
          Open {box.name}/
        </button>
      )}
      {box.parts && <p className="muted">Includes {box.parts.join(", ")}.</p>}

      {fileIdx !== null ? (
        <>
          <FileList title="Uses" items={graph.imports[fileIdx]} snapshot={snapshot} onShow={onShow} />
          <FileList title="Used by" items={graph.importers[fileIdx]} snapshot={snapshot} onShow={onShow} />
          <a className="btn wide" href={`${github}/blob/${snapshot.sha}/${box.target}`} target="_blank" rel="noreferrer">
            <External size={14} /> Open on GitHub
          </a>
        </>
      ) : (
        <>
          <h3>Biggest files</h3>
          <ul className="file-list">
            {biggest.map((i) => (
              <li key={i}>
                <button onClick={() => onShow(files[i].path)}>
                  <span>{files[i].path.slice(files[i].path.lastIndexOf("/") + 1)}</span>
                  <em>{shortNumber(files[i].loc)}</em>
                </button>
              </li>
            ))}
          </ul>
          {(box.used_from_outside > 0 || box.uses_outside > 0) && (
            <p className="muted small">
              Outside this folder: used by {box.used_from_outside} import{box.used_from_outside === 1 ? "" : "s"}, uses{" "}
              {box.uses_outside}.
            </p>
          )}
        </>
      )}
    </>
  );
}

function FileList({ title, items, snapshot, onShow }: { title: string; items: number[]; snapshot: Snapshot; onShow: (p: string) => void }) {
  if (!items.length) return null;
  return (
    <>
      <h3>
        {title} <span className="count">{items.length}</span>
      </h3>
      <ul className="file-list">
        {items.slice(0, 10).map((i) => (
          <li key={i}>
            <button onClick={() => onShow(snapshot.files[i].path)} title={snapshot.files[i].path}>
              <span>{snapshot.files[i].path}</span>
            </button>
          </li>
        ))}
        {items.length > 10 && <li className="more">and {items.length - 10} more</li>}
      </ul>
    </>
  );
}

function describeStep(s: Step): string {
  const a = s.args as Record<string, string>;
  if (s.name === "search_code") return `Searched for “${a.query ?? ""}”`;
  if (s.name === "read_file") return `Read ${a.path ?? "a file"}`;
  if (s.name === "list_dir") return `Looked in ${a.path || "the root folder"}`;
  return s.name;
}
