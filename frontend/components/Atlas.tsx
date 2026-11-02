"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ask,
  fetchHistory,
  fetchRepo,
  fetchSummary,
  fetchTour,
  type AskEvent,
  type Commit,
  type Snapshot,
  type TourStop,
} from "@/lib/api";
import { IMPORTERS_COLOR, IMPORTS_COLOR, langColor } from "@/lib/colors";
import type { GalaxyEngine } from "@/lib/galaxy";
import { buildGraph, filesFor, replay, shortNumber, type Frame } from "@/lib/graph";
import Galaxy from "./Galaxy";
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Clock,
  Close,
  External,
  FileIcon,
  FolderIcon,
  Focus,
  Logo,
  Pause,
  Play,
  Route,
  Search,
  Sparkle,
  Star,
} from "./Icons";
import Markdown from "./Markdown";
import SizeView from "./SizeView";

type View = "galaxy" | "size";
type Step = { name: string; args: Record<string, unknown>; files: string[] };
type Msg = { role: "user"; content: string } | { role: "assistant"; content: string; files: string[]; steps: Step[]; error?: boolean };
type Timelapse = { commits: Commit[]; start: Uint8Array; frames: Frame[]; step: number; playing: boolean; speed: number };

const STAGES = ["Finding the repo", "Downloading the code", "Reading every import", "Placing the stars"];
const SUGGESTIONS = [
  "Where does the app start?",
  "What are the main parts and how do they connect?",
  "How is data stored or fetched?",
  "Where would I add a new feature?",
];

export default function Atlas({ slug }: { slug: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState(0);
  const [view, setView] = useState<View>("galaxy");
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [langFilter, setLangFilter] = useState<string | null>(null);
  const [aiLit, setAiLit] = useState<Set<number> | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [panel, setPanel] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [tour, setTour] = useState<{ stops: TourStop[]; at: number } | null>(null);
  const [tourLoading, setTourLoading] = useState(false);
  const [lapse, setLapse] = useState<Timelapse | null>(null);
  const [lapseLoading, setLapseLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [sizeZoom, setSizeZoom] = useState<{ target: string; key: number } | null>(null);
  const engine = useRef<GalaxyEngine | null>(null);
  const pendingFocus = useRef<number[] | null>(null);
  const summaryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requested = useRef(new Set<string>());
  const chatEnd = useRef<HTMLDivElement>(null);

  // ------------------------------------------------------------- loading

  useEffect(() => {
    let alive = true;
    setSnapshot(null);
    setError("");
    setStage(0);
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 1600);
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

  // ---------------------------------------------------------- highlights

  const highlight = useMemo(() => {
    if (aiLit) return aiLit;
    if (langFilter && snapshot) return new Set(snapshot.files.flatMap((f, i) => (f.lang === langFilter ? [i] : [])));
    return null;
  }, [aiLit, langFilter, snapshot]);

  const visible = useMemo(() => {
    if (!lapse) return null;
    return lapse.step === 0 ? lapse.start : lapse.frames[lapse.step - 1].visible;
  }, [lapse]);

  const focusOn = useCallback(
    (indices: number[], target?: string) => {
      if (view === "size") {
        setSizeZoom({ target: target ?? (indices.length === 1 && snapshot ? snapshot.files[indices[0]].path : ""), key: Date.now() });
        return;
      }
      if (engine.current) engine.current.focus(indices);
      else pendingFocus.current = indices;
    },
    [view, snapshot],
  );

  const onReady = useCallback((e: GalaxyEngine | null) => {
    engine.current = e;
    if (e && pendingFocus.current) {
      e.focus(pendingFocus.current);
      pendingFocus.current = null;
    }
  }, []);

  // ------------------------------------------------------------ summaries

  const loadSummary = useCallback(
    (i: number) => {
      if (!snapshot) return;
      const path = snapshot.files[i].path;
      if (requested.current.has(path)) return;
      requested.current.add(path);
      fetchSummary(snapshot.slug, snapshot.sha, path)
        .then((text) => setSummaries((s) => ({ ...s, [path]: text })))
        .catch(() => setSummaries((s) => ({ ...s, [path]: "" })));
    },
    [snapshot],
  );

  const onHover = useCallback(
    (i: number | null, x: number, y: number) => {
      setHover(i === null ? null : { i, x, y });
      if (summaryTimer.current) clearTimeout(summaryTimer.current);
      if (i !== null) summaryTimer.current = setTimeout(() => loadSummary(i), 380);
    },
    [loadSummary],
  );

  const select = useCallback(
    (i: number | null, fly = false) => {
      setSelected(i);
      if (i !== null) {
        loadSummary(i);
        if (fly && graph) focusOn([i, ...graph.imports[i], ...graph.importers[i]].slice(0, 40), snapshot?.files[i].path);
      }
    },
    [loadSummary, focusOn, graph, snapshot],
  );

  const openFolder = useCallback(
    (folder: string) => {
      if (!snapshot || !graph) return;
      const idx = filesFor(folder + "/", snapshot, graph);
      setAiLit(new Set(idx));
      focusOn(idx, folder + "/");
    },
    [snapshot, graph, focusOn],
  );

  const clearFocus = () => {
    setAiLit(null);
    setLangFilter(null);
    setSelected(null);
    if (view === "galaxy") engine.current?.overview();
    else setSizeZoom({ target: "", key: Date.now() });
  };

  // --------------------------------------------------------------- search

  const results = useMemo(() => {
    if (!snapshot || !query.trim()) return [];
    const q = query.trim().toLowerCase();
    const scored: [number, number][] = [];
    snapshot.files.forEach((f, i) => {
      const p = f.path.toLowerCase();
      const name = p.slice(p.lastIndexOf("/") + 1);
      if (name.startsWith(q)) scored.push([0, i]);
      else if (name.includes(q)) scored.push([1, i]);
      else if (p.includes(q)) scored.push([2, i]);
    });
    scored.sort((a, b) => a[0] - b[0] || snapshot.files[a[1]].path.length - snapshot.files[b[1]].path.length);
    return scored.slice(0, 8).map(([, i]) => i);
  }, [query, snapshot]);

  // ------------------------------------------------------------------ ask

  const resolvePaths = useCallback(
    (paths: string[]) => {
      if (!snapshot || !graph) return [];
      return [...new Set(paths.flatMap((p) => filesFor(p, snapshot, graph)))];
    },
    [snapshot, graph],
  );

  const send = async (question: string) => {
    if (!snapshot || busy || !question.trim()) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: question }, { role: "assistant", content: "", files: [], steps: [] }]);
    setDraft("");
    setBusy(true);
    setTour(null);
    const lit = new Set<number>();
    const update = (fn: (m: Extract<Msg, { role: "assistant" }>) => Extract<Msg, { role: "assistant" }>) =>
      setMessages((all) => {
        const copy = [...all];
        const last = copy[copy.length - 1];
        if (last.role === "assistant") copy[copy.length - 1] = fn(last);
        return copy;
      });
    try {
      await ask(snapshot.slug, snapshot.sha, question, history, (e: AskEvent) => {
        if (e.type === "tool") {
          update((m) => ({ ...m, steps: [...m.steps, { name: e.name, args: e.args, files: e.files }] }));
          const idx = resolvePaths(e.files);
          if (idx.length) {
            idx.forEach((i) => lit.add(i));
            setAiLit(new Set(lit));
            engine.current?.flash(idx);
            focusOn([...lit]);
          }
        } else if (e.type === "answer") {
          update((m) => ({ ...m, content: e.text, files: e.files }));
          const idx = resolvePaths(e.files);
          if (idx.length) {
            setAiLit(new Set(idx));
            engine.current?.flash(idx);
            focusOn(idx, e.files.length === 1 ? e.files[0] : undefined);
          }
        } else {
          update((m) => ({ ...m, content: e.message, error: true }));
        }
      });
    } catch (err) {
      update((m) => ({ ...m, content: (err as Error).message, error: true }));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages]);

  const goToPath = (path: string) => {
    if (!snapshot || !graph) return;
    const i = graph.index.get(path);
    if (i !== undefined) {
      select(i, true);
      return;
    }
    const idx = filesFor(path, snapshot, graph);
    if (idx.length) {
      setAiLit(new Set(idx));
      focusOn(idx, path);
    }
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
      <button key={key} className="path-chip" onClick={() => goToPath(hit)} title="Show on the map">
        {code}
      </button>
    );
  };

  // ----------------------------------------------------------------- tour

  const goStop = useCallback(
    (stops: TourStop[], at: number) => {
      if (!snapshot || !graph) return;
      setTour({ stops, at });
      const stop = stops[at];
      const idx = filesFor(stop.target, snapshot, graph);
      setAiLit(stop.target ? new Set(idx) : null);
      if (graph.index.has(stop.target)) {
        setSelected(graph.index.get(stop.target)!);
        loadSummary(graph.index.get(stop.target)!);
      } else setSelected(null);
      if (stop.target) {
        engine.current?.flash(idx);
        focusOn(idx, stop.target);
      } else if (view === "galaxy") engine.current?.overview();
      else setSizeZoom({ target: "", key: Date.now() });
    },
    [snapshot, graph, focusOn, loadSummary, view],
  );

  const startTour = async () => {
    if (!snapshot || tourLoading) return;
    setLapse(null);
    setTourLoading(true);
    try {
      const stops = await fetchTour(snapshot.slug, snapshot.sha);
      goStop(stops, 0);
    } catch (e) {
      flashNotice((e as Error).message);
    } finally {
      setTourLoading(false);
    }
  };

  // ------------------------------------------------------------ time-lapse

  const startLapse = async () => {
    if (!snapshot || !graph || lapseLoading) return;
    setTour(null);
    setAiLit(null);
    setSelected(null);
    setView("galaxy");
    setLapseLoading(true);
    try {
      const h = await fetchHistory(snapshot.slug, snapshot.sha);
      if (!h.commits.length) throw new Error("No history to replay.");
      const { start, frames } = replay(snapshot, graph, h.commits);
      setLapse({ commits: h.commits, start, frames, step: 0, playing: true, speed: 1 });
      engine.current?.overview(900);
    } catch (e) {
      flashNotice((e as Error).message);
    } finally {
      setLapseLoading(false);
    }
  };

  useEffect(() => {
    if (!lapse?.playing) return;
    if (lapse.step >= lapse.frames.length) {
      setLapse((l) => (l ? { ...l, playing: false } : l));
      return;
    }
    const t = setTimeout(() => {
      setLapse((l) => (l ? { ...l, step: l.step + 1 } : l));
    }, 420 / lapse.speed);
    return () => clearTimeout(t);
  }, [lapse?.playing, lapse?.step, lapse?.speed, lapse?.frames.length]);

  const lapseStep = lapse?.step ?? 0;
  useEffect(() => {
    if (!lapse || lapseStep === 0) return;
    engine.current?.flash(lapse.frames[lapseStep - 1].touched);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lapseStep]);

  // --------------------------------------------------------------- misc

  const flashNotice = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(""), 4500);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (searchOpen) setSearchOpen(false);
        else if (selected !== null) setSelected(null);
        else if (aiLit || langFilter) {
          setAiLit(null);
          setLangFilter(null);
        }
      }
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        document.getElementById("atlas-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen, selected, aiLit, langFilter]);

  // -------------------------------------------------------------- render

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
        <div className="orbit" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <p className="state-title">Mapping {slug}</p>
        <p className="state-text">{STAGES[stage]}…</p>
      </div>
    );
  }

  const github = `https://github.com/${snapshot.slug}`;
  const sel = selected !== null ? snapshot.files[selected] : null;
  const hov = hover ? snapshot.files[hover.i] : null;
  const commit = lapse && lapse.step > 0 ? lapse.commits[lapse.step - 1] : null;

  return (
    <div className={`atlas ${panel ? "panel-open" : ""}`}>
      <div className="stage">
        {view === "galaxy" ? (
          <Galaxy
            snapshot={snapshot}
            graph={graph}
            highlight={highlight}
            visible={visible}
            selected={selected}
            onReady={onReady}
            onHover={onHover}
            onSelect={(i) => select(i)}
            onFolder={openFolder}
          />
        ) : (
          <SizeView
            snapshot={snapshot}
            highlight={highlight}
            selected={selected}
            zoomTo={sizeZoom}
            onHover={onHover}
            onSelect={(i) => select(i)}
          />
        )}

        {/* ---------------------------------------------------- top bar */}
        <header className="topbar">
          <div className="repo-card">
            <Link href="/" className="brand" aria-label="Repo Atlas home">
              <Logo />
            </Link>
            <div className="repo-meta">
              <a href={github} target="_blank" rel="noreferrer" className="repo-name">
                {snapshot.slug}
              </a>
              <div className="repo-stats">
                <span>
                  <Star size={12} /> {shortNumber(snapshot.stars || 0)}
                </span>
                <span>{shortNumber(snapshot.totals.files)} files</span>
                <span>{shortNumber(snapshot.totals.loc)} lines</span>
                <span>{shortNumber(snapshot.totals.edges)} imports</span>
              </div>
            </div>
          </div>

          <div className="search">
            <Search size={15} />
            <input
              id="atlas-search"
              value={query}
              placeholder="Find a file"
              autoComplete="off"
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results.length) {
                  select(results[0], true);
                  setSearchOpen(false);
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
            <kbd>/</kbd>
            {searchOpen && results.length > 0 && (
              <ul className="search-results">
                {results.map((i) => (
                  <li key={i}>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        select(i, true);
                        setSearchOpen(false);
                      }}
                    >
                      <i style={{ background: langColor(snapshot.files[i].lang) }} />
                      <span className="r-name">{snapshot.files[i].path.split("/").pop()}</span>
                      <span className="r-path">{snapshot.files[i].path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="tools">
            <div className="seg" role="tablist">
              <button className={view === "galaxy" ? "on" : ""} onClick={() => setView("galaxy")}>
                Galaxy
              </button>
              <button
                className={view === "size" ? "on" : ""}
                onClick={() => {
                  setLapse(null);
                  setView("size");
                }}
              >
                Size
              </button>
            </div>
            <button className={`tool ${lapse ? "on" : ""}`} onClick={() => (lapse ? setLapse(null) : startLapse())} disabled={lapseLoading}>
              <Clock size={15} /> <span>{lapseLoading ? "Loading history…" : "Time-lapse"}</span>
            </button>
            <button className={`tool ${tour ? "on" : ""}`} onClick={() => (tour ? setTour(null) : startTour())} disabled={tourLoading}>
              <Route size={15} /> <span>{tourLoading ? "Planning…" : "Tour"}</span>
            </button>
            <button className={`tool ask-btn ${panel ? "on" : ""}`} onClick={() => setPanel((p) => !p)}>
              <Sparkle size={15} /> <span>Ask</span>
            </button>
          </div>
        </header>

        {/* ------------------------------------------------- selected file */}
        {sel && selected !== null && (
          <aside className="file-card">
            <div className="fc-head">
              <i style={{ background: langColor(sel.lang) }} />
              <div className="fc-title">
                <strong>{sel.path.split("/").pop()}</strong>
                <span>{sel.path.includes("/") ? sel.path.slice(0, sel.path.lastIndexOf("/") + 1) : "repo root"}</span>
              </div>
              <button className="icon-btn" onClick={() => setSelected(null)} aria-label="Close">
                <Close size={15} />
              </button>
            </div>
            <div className="fc-stats">
              <span>{sel.lang}</span>
              <span>{sel.loc.toLocaleString()} lines</span>
            </div>
            <p className={`fc-summary ${summaries[sel.path] === undefined ? "loading" : ""}`}>
              {summaries[sel.path] === undefined ? "Reading the file…" : summaries[sel.path] || "No summary right now."}
            </p>
            <FileList
              title="Imports"
              color={IMPORTS_COLOR}
              items={graph.imports[selected]}
              snapshot={snapshot}
              onPick={(i) => select(i, true)}
            />
            <FileList
              title="Imported by"
              color={IMPORTERS_COLOR}
              items={graph.importers[selected]}
              snapshot={snapshot}
              onPick={(i) => select(i, true)}
            />
            <div className="fc-actions">
              <button className="btn" onClick={() => focusOn([selected, ...graph.imports[selected], ...graph.importers[selected]].slice(0, 40), sel.path)}>
                <Focus size={14} /> Fly to it
              </button>
              <a className="btn" href={`${github}/blob/${snapshot.sha}/${sel.path}`} target="_blank" rel="noreferrer">
                <External size={14} /> Open on GitHub
              </a>
            </div>
          </aside>
        )}

        {/* ------------------------------------------------------- legend */}
        {!lapse && (
          <div className="legend">
            {snapshot.languages.slice(0, 9).map((l) => (
              <button
                key={l.lang}
                className={langFilter === l.lang ? "on" : langFilter ? "off" : ""}
                onClick={() => {
                  setAiLit(null);
                  setLangFilter(langFilter === l.lang ? null : l.lang);
                }}
              >
                <i style={{ background: langColor(l.lang), color: langColor(l.lang) }} />
                {l.lang}
                <span>{shortNumber(l.files)}</span>
              </button>
            ))}
            {(aiLit || langFilter || selected !== null) && (
              <button className="reset" onClick={clearFocus}>
                Show everything
              </button>
            )}
          </div>
        )}

        {/* ------------------------------------------------------ tooltip */}
        {hov && hover && (
          <div
            className="tooltip"
            style={{
              left: Math.min(hover.x + 16, (typeof window !== "undefined" ? window.innerWidth : 1200) - 300),
              top: hover.y + 16,
            }}
          >
            <div className="tt-path">
              <i style={{ background: langColor(hov.lang) }} />
              {hov.path}
            </div>
            <div className="tt-stats">
              {hov.loc.toLocaleString()} lines · imports {graph.imports[hover.i].length} · imported by {graph.importers[hover.i].length}
            </div>
            {summaries[hov.path] !== undefined ? (
              summaries[hov.path] && <p className="tt-summary">{summaries[hov.path]}</p>
            ) : (
              <p className="tt-summary loading">Summarizing…</p>
            )}
          </div>
        )}

        {/* --------------------------------------------------------- tour */}
        {tour && (
          <div className="tour-card">
            <div className="tc-top">
              <span className="tc-count">
                Stop {tour.at + 1} of {tour.stops.length}
              </span>
              <button className="icon-btn" onClick={() => setTour(null)} aria-label="End tour">
                <Close size={15} />
              </button>
            </div>
            <h3>{tour.stops[tour.at].title}</h3>
            {tour.stops[tour.at].target && (
              <button className="path-chip" onClick={() => goToPath(tour.stops[tour.at].target)}>
                {tour.stops[tour.at].target.endsWith("/") ? <FolderIcon size={12} /> : <FileIcon size={12} />}
                {tour.stops[tour.at].target}
              </button>
            )}
            <p>{tour.stops[tour.at].text}</p>
            <div className="tc-nav">
              <div className="tc-dots">
                {tour.stops.map((_, k) => (
                  <button key={k} className={k === tour.at ? "on" : ""} onClick={() => goStop(tour.stops, k)} aria-label={`Stop ${k + 1}`} />
                ))}
              </div>
              <div className="tc-btns">
                <button className="btn" disabled={tour.at === 0} onClick={() => goStop(tour.stops, tour.at - 1)}>
                  <ChevronLeft size={15} />
                </button>
                {tour.at < tour.stops.length - 1 ? (
                  <button className="btn primary" onClick={() => goStop(tour.stops, tour.at + 1)}>
                    Next <ChevronRight size={15} />
                  </button>
                ) : (
                  <button
                    className="btn primary"
                    onClick={() => {
                      setTour(null);
                      clearFocus();
                    }}
                  >
                    Finish
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* --------------------------------------------------- time-lapse */}
        {lapse && (
          <div className="lapse">
            <div className="lapse-commit">
              {commit ? (
                <>
                  <span className="avatar" style={{ background: authorColor(commit.author) }}>
                    {commit.author.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{commit.message}</strong>
                    <span>
                      {commit.author} · {new Date(commit.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} ·{" "}
                      {commit.files.length} file{commit.files.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </>
              ) : (
                <div>
                  <strong>Before the last {lapse.commits.length} commits</strong>
                  <span>Press play to watch the repo grow</span>
                </div>
              )}
            </div>
            <div className="lapse-controls">
              <button
                className="play"
                onClick={() =>
                  setLapse((l) => (l ? { ...l, playing: !l.playing, step: !l.playing && l.step >= l.frames.length ? 0 : l.step } : l))
                }
                aria-label={lapse.playing ? "Pause" : "Play"}
              >
                {lapse.playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <input
                type="range"
                min={0}
                max={lapse.frames.length}
                value={lapse.step}
                onChange={(e) => setLapse((l) => (l ? { ...l, step: Number(e.target.value), playing: false } : l))}
              />
              <span className="lapse-date">{commit ? new Date(commit.date).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : ""}</span>
              <button className="speed" onClick={() => setLapse((l) => (l ? { ...l, speed: l.speed >= 8 ? 1 : l.speed * 2 } : l))}>
                {lapse.speed}×
              </button>
              <button className="icon-btn" onClick={() => setLapse(null)} aria-label="Close time-lapse">
                <Close size={15} />
              </button>
            </div>
          </div>
        )}

        {notice && <div className="notice">{notice}</div>}
      </div>

      {/* ----------------------------------------------------- ask panel */}
      <aside className="ask-panel" aria-hidden={!panel}>
        <div className="ap-head">
          <div>
            <strong>Ask the map</strong>
            <span>An AI guide reads the code and lights up what it finds.</span>
          </div>
          <button className="icon-btn" onClick={() => setPanel(false)} aria-label="Close">
            <Close size={16} />
          </button>
        </div>
        <div className="ap-body">
          {messages.length === 0 && (
            <div className="ap-empty">
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
          className="ap-input"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <textarea
            value={draft}
            rows={1}
            placeholder="How does auth work here?"
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
      </aside>
    </div>
  );
}

function FileList({
  title,
  color,
  items,
  snapshot,
  onPick,
}: {
  title: string;
  color: string;
  items: number[];
  snapshot: Snapshot;
  onPick: (i: number) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="fc-list">
      <p>
        <i style={{ background: color }} /> {title} <span>{items.length}</span>
      </p>
      <ul>
        {items.slice(0, 8).map((i) => (
          <li key={i}>
            <button onClick={() => onPick(i)} title={snapshot.files[i].path}>
              {snapshot.files[i].path}
            </button>
          </li>
        ))}
        {items.length > 8 && <li className="more">and {items.length - 8} more</li>}
      </ul>
    </div>
  );
}

function describeStep(s: Step): string {
  const a = s.args as Record<string, string>;
  if (s.name === "search_code") return `Searched for “${a.query ?? ""}”${s.files.length ? ` · ${s.files.length} files` : ""}`;
  if (s.name === "read_file") return `Read ${a.path ?? "a file"}`;
  if (s.name === "list_dir") return `Looked in ${a.path || "the root folder"}`;
  return s.name;
}

function authorColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 55%)`;
}
