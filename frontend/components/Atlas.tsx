"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ask,
  fetchEvidence,
  fetchExplain,
  fetchLevel,
  fetchRepo,
  fetchSummary,
  fetchTimeline,
  type AskEvent,
  type Evidence,
  type Explain,
  type Level,
  type Snapshot,
  type Timeline,
} from "@/lib/api";
import {
  buildGraph,
  dependents,
  pairsBetween,
  shortNumber,
  type Graph,
} from "@/lib/graph";
import type { Box, Link as Arrow } from "@/lib/layout";
import Diagram from "./Diagram";
import {
  ArrowUp,
  ChevronLeft,
  Close,
  External,
  History,
  Logo,
  Star,
} from "./Icons";
import TimelineBar, { lerp, month, riverBands } from "./TimelineBar";
import Markdown from "./Markdown";
import ThemeToggle from "./ThemeToggle";

type Step = { name: string; args: Record<string, unknown>; files: string[] };
type Msg =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      files: string[];
      steps: Step[];
      error?: boolean;
    };

const STAGES = [
  "Finding the repo",
  "Downloading the code",
  "Reading the imports",
  "Drawing the diagram",
];
const SUGGESTIONS = [
  "Where does the app start?",
  "How do the main parts work together?",
  "Where would I add a new feature?",
];

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
  const [arrow, setArrow] = useState<Arrow | null>(null);
  const [history, setHistory] = useState(false);
  const [tl, setTl] = useState<Timeline | null>(null);
  const [tlError, setTlError] = useState("");
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [band, setBand] = useState<number | null>(null); // box hovered in the river or the diagram
  const chatEnd = useRef<HTMLDivElement>(null);

  // --------------------------------------------------------------- loading

  useEffect(() => {
    let alive = true;
    setSnapshot(null);
    setError("");
    setStage(0);
    setPath(readPath());
    const timer = setInterval(
      () => setStage((s) => Math.min(s + 1, STAGES.length - 1)),
      1500,
    );
    fetchRepo(slug)
      .then((s) => alive && setSnapshot(s))
      .catch((e) => alive && setError(e.message))
      .finally(() => clearInterval(timer));
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [slug]);

  const graph = useMemo(
    () => (snapshot ? buildGraph(snapshot) : null),
    [snapshot],
  );

  useEffect(() => {
    if (!snapshot) return;
    let alive = true;
    setLevelError("");
    setSelected(null);
    setArrow(null);
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

  // ---------------------------------------------------------------- history

  useEffect(() => {
    if (!history || !snapshot || !level) return;
    let alive = true;
    setTlError("");
    fetchTimeline(snapshot.slug, snapshot.sha, level.path)
      .then((t) => {
        if (!alive) return;
        setTl((old) => {
          if (!old) {
            setFrame(0);
            setPlaying(true);
          }
          return t;
        });
      })
      .catch((e) => alive && setTlError(e.message));
    return () => {
      alive = false;
    };
  }, [history, snapshot, level]);

  // Smooth playback: the whole history takes about 14 seconds, whatever its length.
  useEffect(() => {
    if (!playing || !tl) return;
    const last = tl.frames.length - 1;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(100, now - prev);
      prev = now;
      let done = false;
      setFrame((f) => {
        const next = f + (dt / 14000) * last;
        if (next >= last) {
          done = true;
          return last;
        }
        return next;
      });
      if (done) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, tl]);

  const colors = useMemo(() => {
    const m = new Map<number, string>();
    if (tl && level)
      for (const b of riverBands(level.boxes, tl)) m.set(b.k, b.color);
    return m;
  }, [tl, level]);

  const growth = useMemo(() => {
    if (!history || !tl || !level) return null;
    const m = new Map<
      number,
      { lines: number; files: number; grew: boolean; color?: string }
    >();
    const i = Math.floor(frame);
    level.boxes.forEach((b, k) => {
      const s = tl.boxes[b.id];
      if (!s) return;
      const lines = s.lines[i] ? Math.round(lerp(s.lines, frame)) : 0;
      m.set(k, {
        lines,
        files: s.files[Math.round(frame)] ?? 0,
        // growing right now by a real step, not a one-line fix
        grew:
          i + 1 < s.lines.length &&
          s.lines[i + 1] - s.lines[i] > Math.max(20, b.loc * 0.03),
        color: colors.get(k),
      });
    });
    return m.size ? m : null;
  }, [history, tl, level, frame, colors]);

  const toggleHistory = () => {
    if (history) {
      setHistory(false);
      setPlaying(false);
      return;
    }
    setSelected(null);
    setArrow(null);
    setLitPaths(null);
    setTab("explain");
    setHistory(true);
    if (tl) {
      setFrame(0);
      setPlaying(true);
    }
  };

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
        .catch(() =>
          setSummaries((s) => ({ ...s, [filePath]: "No summary right now." })),
        );
    },
    [snapshot, summaries],
  );

  const open = (b: Box, k: number) => {
    if (b.kind === "folder" && selected === k) {
      go(b.target);
      return;
    }
    if (history) return;
    setSelected(k);
    setArrow(null);
    setTab("explain");
    if (b.kind === "file") loadSummary(b.target);
  };

  const prove = (l: Arrow) => {
    if (history) return;
    setSelected(null);
    setArrow(l);
    setTab("explain");
  };

  // What a change to the selected box would reach: every file that imports
  // it, directly or through other files, counted per box on this level.
  const blast = useMemo(() => {
    if (!graph || !level || selected === null) return null;
    const b = level.boxes[selected];
    if (!b) return null;
    const d = dependents(graph, b.files);
    const reached = new Set(d.all);
    const perBox = new Map<number, number>();
    let onLevel = 0;
    level.boxes.forEach((o, k) => {
      if (k === selected) return;
      const n = o.files.filter((f) => reached.has(f)).length;
      if (n) perBox.set(k, n);
      onLevel += n;
    });
    return { ...d, perBox, outside: d.all.length - onLevel };
  }, [graph, level, selected]);

  // Boxes on this level that hold files the AI mentioned.
  const lit = useMemo(() => {
    if (!litPaths || !level || !graph) return null;
    const s = new Set<number>();
    level.boxes.forEach((b, k) => {
      const members = new Set(b.files);
      for (const p of litPaths) {
        const i = graph.index.get(p);
        if (
          i !== undefined
            ? members.has(i)
            : b.target &&
              (b.target === p ||
                b.target.startsWith(p) ||
                p.startsWith(b.target))
        )
          s.add(k);
      }
    });
    return s.size ? s : null;
  }, [litPaths, level, graph]);

  // -------------------------------------------------------------------- ask

  const send = async (question: string) => {
    if (!snapshot || busy || question.trim().length < 2) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [
      ...m,
      { role: "user", content: question },
      { role: "assistant", content: "", files: [], steps: [] },
    ]);
    setDraft("");
    setBusy(true);
    const update = (
      fn: (
        m: Extract<Msg, { role: "assistant" }>,
      ) => Extract<Msg, { role: "assistant" }>,
    ) =>
      setMessages((all) => {
        const copy = [...all];
        const last = copy[copy.length - 1];
        if (last.role === "assistant") copy[copy.length - 1] = fn(last);
        return copy;
      });
    try {
      await ask(
        snapshot.slug,
        snapshot.sha,
        question,
        history,
        (e: AskEvent) => {
          if (e.type === "tool")
            update((m) => ({
              ...m,
              steps: [
                ...m.steps,
                { name: e.name, args: e.args, files: e.files },
              ],
            }));
          else if (e.type === "answer") {
            update((m) => ({ ...m, content: e.text, files: e.files }));
            setLitPaths(e.files.length ? e.files : null);
          } else update((m) => ({ ...m, content: e.message, error: true }));
        },
      );
    } catch (err) {
      update((m) => ({ ...m, content: (err as Error).message, error: true }));
    } finally {
      setBusy(false);
    }
  };

  useEffect(
    () => chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }),
    [messages],
  );

  // Jump to the folder that holds a path and select it there.
  const showPath = (p: string) => {
    if (!snapshot) return;
    const folder = p.endsWith("/")
      ? p
      : p.includes("/")
        ? p.slice(0, p.lastIndexOf("/") + 1)
        : "";
    setLitPaths([p]);
    if (folder !== level?.path) go(folder);
  };

  const codeSpan = (code: string, key: number) => {
    if (!snapshot || !graph) return <code key={key}>{code}</code>;
    const clean = code.replace(/^\.\//, "").replace(/:\d+(-\d+)?$/, "");
    const hit = graph.index.has(clean)
      ? clean
      : (snapshot.files.find((f) => f.path.endsWith("/" + clean))?.path ??
        (snapshot.files.some((f) =>
          f.path.startsWith(clean.replace(/\/?$/, "/")),
        )
          ? clean.replace(/\/?$/, "/")
          : null));
    if (!hit) return <code key={key}>{code}</code>;
    return (
      <button
        key={key}
        className="path-chip"
        onClick={() => showPath(hit)}
        title="Show it in the diagram"
      >
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
          <a
            href={github}
            target="_blank"
            rel="noreferrer"
            className="repo-name"
          >
            {snapshot.slug}
          </a>
          <span className="repo-stats">
            <Star size={12} /> {shortNumber(snapshot.stars || 0)} ·{" "}
            {shortNumber(snapshot.totals.files)} files ·{" "}
            {shortNumber(snapshot.totals.loc)} lines
          </span>
        </div>
        <div className="topbar-end">
          <ThemeToggle />
        </div>
      </header>

      <main className={`canvas ${history ? "playing" : ""}`}>
        <div className="canvas-head">
          {level && (
            <nav className="crumbs" aria-label="Folder">
              {level.crumbs.map((c, k) => (
                <span key={c.path}>
                  {k > 0 && <span className="sep">/</span>}
                  {k < level.crumbs.length - 1 ? (
                    <button onClick={() => go(c.path)}>{c.name}</button>
                  ) : (
                    <strong>{c.name}</strong>
                  )}
                </span>
              ))}
            </nav>
          )}
          {level && (
            <button
              className={`btn history-btn ${history ? "on" : ""}`}
              onClick={toggleHistory}
            >
              {history ? <Close size={15} /> : <History size={16} />}
              {history ? "Close history" : "Play history"}
            </button>
          )}
        </div>
        {levelError && <p className="state-text center">{levelError}</p>}
        {level && (
          <Diagram
            key={level.path}
            boxes={level.boxes}
            links={level.links}
            roles={explain?.boxes ?? (explainError ? {} : null)}
            start={explain?.start ?? ""}
            selected={selected}
            lit={history ? (band !== null ? new Set([band]) : null) : lit}
            onHoverBox={history ? setBand : undefined}
            impact={!history && blast?.perBox.size ? blast.perBox : null}
            growth={growth}
            link={arrow}
            onOpen={open}
            onLink={prove}
          />
        )}
        {history &&
          (tl ? (
            <TimelineBar
              data={tl}
              boxes={level?.boxes ?? []}
              t={frame}
              playing={playing}
              hover={band}
              onHover={setBand}
              onSeek={(f) => {
                setPlaying(false);
                setFrame(f);
              }}
              onPlay={() => {
                if (!playing && frame >= tl.frames.length - 1) setFrame(0);
                setPlaying(!playing);
              }}
            />
          ) : (
            <div className="player">
              <p className={tlError ? "muted" : "summary loading"}>
                {tlError || "Reading the history…"}
              </p>
            </div>
          ))}
        {level && !history && (
          <p className="hint">
            Arrows point from a part to the parts it uses. Click an arrow to see
            the import lines behind it, or a box to see what depends on it.
          </p>
        )}
      </main>

      <aside className="side">
        <div className="tabs" role="tablist">
          <button
            className={tab === "explain" ? "on" : ""}
            onClick={() => setTab("explain")}
          >
            Explain
          </button>
          <button
            className={tab === "ask" ? "on" : ""}
            onClick={() => setTab("ask")}
          >
            Ask
          </button>
        </div>

        {tab === "explain" && level && history && (
          <div className="side-body">
            <HistoryPanel
              tl={tl}
              level={level}
              frame={Math.round(frame)}
              colors={colors}
              onFrame={(f) => {
                setPlaying(false);
                setFrame(f);
              }}
            />
          </div>
        )}
        {tab === "explain" && level && !history && (
          <div className="side-body">
            {arrow && level.boxes[arrow.from] && level.boxes[arrow.to] ? (
              <LinkDetails
                key={`${arrow.from}-${arrow.to}`}
                from={level.boxes[arrow.from]}
                to={level.boxes[arrow.to]}
                snapshot={snapshot}
                graph={graph}
                github={github}
                onBack={() => setArrow(null)}
              />
            ) : !box ? (
              <>
                <h2>{level.path ? here?.name + "/" : "What this repo is"}</h2>
                <p className="muted">
                  {level.boxes.length} parts ·{" "}
                  {shortNumber(
                    level.boxes.reduce((a, b) => a + b.files.length, 0),
                  )}{" "}
                  files
                </p>
                {explain ? (
                  <p className="summary">{explain.summary}</p>
                ) : explainError ? (
                  <p className="summary muted">{explainError}</p>
                ) : (
                  <p className="summary loading">
                    Reading the code to explain it…
                  </p>
                )}
                {explain?.start && (
                  <button
                    className="start-chip"
                    onClick={() => {
                      const k = level.boxes.findIndex(
                        (b) => b.name === explain.start,
                      );
                      if (k >= 0) open(level.boxes[k], k);
                    }}
                  >
                    Start reading at <strong>{explain.start}</strong> →
                  </button>
                )}
                {!level.path && (
                  <RepoFacts snapshot={snapshot} onShow={showPath} />
                )}
                {level.links.length > 0 && (
                  <>
                    <h3>How the parts connect</h3>
                    <ul className="flows">
                      {level.links.slice(0, 6).map((l, k) => (
                        <li key={k}>
                          <button onClick={() => prove(l)}>
                            <strong>{level.boxes[l.from].name}</strong> uses{" "}
                            <strong>{level.boxes[l.to].name}</strong>
                            <span>
                              {" "}
                              · {l.count} import{l.count === 1 ? "" : "s"}
                            </span>
                          </button>
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
                        <span>
                          <strong>
                            {b.kind === "folder" ? b.name + "/" : b.name}
                          </strong>
                          <em>
                            {explain?.boxes[b.name] ||
                              `${b.files.length} files`}
                          </em>
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
                summary={
                  box.kind === "file" ? summaries[box.target] : undefined
                }
                github={github}
                blast={blast}
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
                  <p className="muted">
                    Ask anything about this repo. The AI reads the code to
                    answer and highlights the parts it talks about.
                  </p>
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
              <button
                type="submit"
                disabled={busy || draft.trim().length < 2}
                aria-label="Send"
              >
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
  blast,
  onBack,
  onOpenFolder,
  onShow,
}: {
  box: Box;
  snapshot: Snapshot;
  graph: Graph;
  role?: string;
  summary?: string;
  github: string;
  blast: { all: number[]; direct: Set<number> } | null;
  onBack: () => void;
  onOpenFolder: () => void;
  onShow: (p: string) => void;
}) {
  const files = snapshot.files;
  const biggest = [...box.files]
    .sort((a, b) => files[b].loc - files[a].loc)
    .slice(0, 8);
  const fileIdx = box.kind === "file" ? box.files[0] : null;
  return (
    <>
      <button className="back" onClick={onBack}>
        <ChevronLeft size={14} /> Overview
      </button>
      <h2>{box.kind === "folder" ? box.name + "/" : box.name}</h2>
      <p className="muted">
        {box.files.length === 1 ? "1 file" : `${box.files.length} files`} ·{" "}
        {box.loc.toLocaleString()} lines
        {box.langs.length > 0 &&
          " · " + box.langs.map((l) => l.lang).join(", ")}
      </p>
      {box.kind === "file" ? (
        <p className={`summary ${summary ? "" : "loading"}`}>
          {summary || "Reading the file…"}
        </p>
      ) : (
        role && <p className="summary">{role}</p>
      )}
      {box.kind === "folder" && (
        <button className="btn primary wide" onClick={onOpenFolder}>
          Open {box.name}/
        </button>
      )}
      {box.parts && <p className="muted">Includes {box.parts.join(", ")}.</p>}
      {blast && <Blast blast={blast} graph={graph} onShow={onShow} />}

      {fileIdx !== null ? (
        <>
          <FileList
            title="Uses"
            items={graph.imports[fileIdx]}
            snapshot={snapshot}
            onShow={onShow}
          />
          <FileList
            title="Used by"
            items={graph.importers[fileIdx]}
            snapshot={snapshot}
            onShow={onShow}
          />
          <a
            className="btn wide"
            href={`${github}/blob/${snapshot.sha}/${box.target}`}
            target="_blank"
            rel="noreferrer"
          >
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
                  <span title={files[i].path}>
                    {box.target && files[i].path.startsWith(box.target)
                      ? files[i].path.slice(box.target.length)
                      : files[i].path}
                  </span>
                  <em>{shortNumber(files[i].loc)}</em>
                </button>
              </li>
            ))}
          </ul>
          {(box.used_from_outside > 0 || box.uses_outside > 0) && (
            <p className="muted small">
              Outside this folder: used by {box.used_from_outside} import
              {box.used_from_outside === 1 ? "" : "s"}, uses {box.uses_outside}.
            </p>
          )}
        </>
      )}
    </>
  );
}

function FileList({
  title,
  items,
  snapshot,
  onShow,
}: {
  title: string;
  items: number[];
  snapshot: Snapshot;
  onShow: (p: string) => void;
}) {
  if (!items.length) return null;
  return (
    <>
      <h3>
        {title} <span className="count">{items.length}</span>
      </h3>
      <ul className="file-list">
        {items.slice(0, 10).map((i) => (
          <li key={i}>
            <button
              onClick={() => onShow(snapshot.files[i].path)}
              title={snapshot.files[i].path}
            >
              <span>{snapshot.files[i].path}</span>
            </button>
          </li>
        ))}
        {items.length > 10 && (
          <li className="more">and {items.length - 10} more</li>
        )}
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

function RepoFacts({
  snapshot,
  onShow,
}: {
  snapshot: Snapshot;
  onShow: (p: string) => void;
}) {
  const built = [...(snapshot.stack || []), ...(snapshot.tools || [])];
  const langs = snapshot.languages.filter((l) => l.loc > 0);
  const total = langs.reduce((a, l) => a + l.loc, 0) || 1;
  const major = langs.filter((l) => l.loc / total >= 0.03).slice(0, 4);
  const entries = snapshot.entries || [];
  return (
    <dl className="facts">
      {built.length > 0 && (
        <>
          <dt>Built with</dt>
          <dd>{built.join(", ")}</dd>
        </>
      )}
      <dt>Languages</dt>
      <dd>
        {major
          .map((l) => `${l.lang} ${Math.round((l.loc / total) * 100)}%`)
          .join(", ")}
      </dd>
      {entries.length > 0 && (
        <>
          <dt>Entry points</dt>
          <dd className="entry-list">
            {entries.map((e) => (
              <button
                key={e}
                className="path-chip"
                onClick={() => onShow(e)}
                title="Show it in the diagram"
              >
                {e}
              </button>
            ))}
          </dd>
        </>
      )}
    </dl>
  );
}

function Blast({
  blast,
  graph,
  onShow,
}: {
  blast: { all: number[]; direct: Set<number> };
  graph: Graph;
  onShow: (p: string) => void;
}) {
  const n = blast.all.length;
  const folders = new Map<string, number>();
  for (const f of blast.all) {
    const d = graph.folderOf[f];
    folders.set(d, (folders.get(d) || 0) + 1);
  }
  const top = [...folders].sort((a, b) => b[1] - a[1]).slice(0, 6);
  return (
    <>
      <h3>If you change this</h3>
      {n === 0 ? (
        <p className="muted">Nothing else in the repo imports it.</p>
      ) : (
        <div className="blast">
          <p className="blast-num">
            <strong>{n.toLocaleString()}</strong> file
            {n === 1 ? " depends" : "s depend"} on it, {blast.direct.size}{" "}
            directly. They are outlined on the diagram.
          </p>
          <ul className="file-list">
            {top.map(([d, c]) => (
              <li key={d}>
                <button onClick={() => onShow(d ? d + "/" : "")}>
                  <span>{d ? d + "/" : "(root)"}</span>
                  <em>{c}</em>
                </button>
              </li>
            ))}
            {folders.size > top.length && (
              <li className="more">
                and {folders.size - top.length} more folders
              </li>
            )}
          </ul>
        </div>
      )}
    </>
  );
}

function LinkDetails({
  from,
  to,
  snapshot,
  graph,
  github,
  onBack,
}: {
  from: Box;
  to: Box;
  snapshot: Snapshot;
  graph: Graph;
  github: string;
  onBack: () => void;
}) {
  const files = snapshot.files;
  const pairs = useMemo(
    () => pairsBetween(graph, from.files, to.files),
    [graph, from, to],
  );
  const [proof, setProof] = useState<Evidence[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const ask = pairs
      .slice(0, 40)
      .map(([a, b]) => [files[a].path, files[b].path] as [string, string]);
    fetchEvidence(snapshot.slug, snapshot.sha, ask)
      .then((e) => alive && setProof(e))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [pairs, files, snapshot.slug, snapshot.sha]);
  const users = new Set(pairs.map((p) => p[0])).size;
  const name = (b: Box) => (b.kind === "folder" ? b.name + "/" : b.name);
  return (
    <>
      <button className="back" onClick={onBack}>
        <ChevronLeft size={14} /> Overview
      </button>
      <h2>
        {name(from)} uses {name(to)}
      </h2>
      <p className="muted">
        {pairs.length} import{pairs.length === 1 ? "" : "s"} from {users} file
        {users === 1 ? "" : "s"}. Each one is the real line in the code, linked
        to GitHub.
      </p>
      {failed && (
        <p className="muted">Couldn&apos;t load the import lines right now.</p>
      )}
      {!proof && !failed && (
        <p className="summary loading">Finding the import lines…</p>
      )}
      {proof && (
        <ul className="proof">
          {proof.map((e, k) => (
            <li key={k}>
              <div className="proof-head">
                <span title={e.from}>{e.from}</span>
                <a
                  href={`${github}/blob/${snapshot.sha}/${e.from}${e.line ? `#L${e.line}` : ""}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {e.line ? `line ${e.line}` : "open"} ↗
                </a>
              </div>
              {e.text && (
                <pre>
                  <i>{e.line}</i>
                  {e.text.trim()}
                </pre>
              )}
              <div className="proof-to" title={e.to}>
                → {e.to}
              </div>
            </li>
          ))}
          {pairs.length > proof.length && (
            <li className="more muted small">
              and {pairs.length - proof.length} more imports
            </li>
          )}
        </ul>
      )}
    </>
  );
}

function HistoryPanel({
  tl,
  level,
  frame,
  colors,
  onFrame,
}: {
  colors: Map<number, string>;
  tl: Timeline | null;
  level: import("@/lib/api").Level;
  frame: number;
  onFrame: (f: number) => void;
}) {
  if (!tl) return <p className="summary loading">Reading the history…</p>;
  const fr = tl.frames;
  const first = fr[0];
  const now = fr[fr.length - 1];
  const born = level.boxes
    .map((b, k) => ({
      b,
      k,
      at: tl.boxes[b.id]?.lines.findIndex((v) => v > 0) ?? -1,
    }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at);
  let jump = 1;
  for (let i = 2; i < fr.length; i++)
    if (fr[i].lines - fr[i - 1].lines > fr[jump].lines - fr[jump - 1].lines)
      jump = i;
  const grew = fr.length > 1 ? fr[jump].lines - fr[jump - 1].lines : 0;
  return (
    <>
      <h2>How it grew</h2>
      <p className="muted">
        {tl.commits.toLocaleString()} commits from {month(first.date)} to{" "}
        {month(now.date)}, shown at {fr.length} evenly spaced points.
      </p>
      <dl className="facts">
        <dt>First commit</dt>
        <dd>
          {month(first.date)} by {first.author}
        </dd>
        <dt>Today</dt>
        <dd>
          {shortNumber(now.files)} files, {shortNumber(now.lines)} lines
        </dd>
        {grew > 0 && (
          <>
            <dt>Biggest jump</dt>
            <dd>
              <button className="link-btn" onClick={() => onFrame(jump)}>
                +{shortNumber(grew)} lines by {month(fr[jump].date)}
              </button>
            </dd>
          </>
        )}
      </dl>
      <h3>When each part appeared</h3>
      <ul className="file-list">
        {born.map(({ b, k, at }) => (
          <li key={b.id}>
            <button
              className={at <= frame ? "" : "later"}
              onClick={() => onFrame(at)}
            >
              <span>
                <i className="swatch" style={{ background: colors.get(k) }} />
                {b.kind === "folder" ? b.name + "/" : b.name}
              </span>
              <em>{at === 0 ? "from the start" : month(fr[at].date)}</em>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Sizes come from each commit&apos;s file tree. Arrows show today&apos;s
        imports between the parts that existed at that point.
      </p>
    </>
  );
}
