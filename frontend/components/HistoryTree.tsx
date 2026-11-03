"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { langColor } from "@/lib/colors";
import { shortNumber } from "@/lib/graph";
import { at, lerp, type HistoryData, type Tree } from "@/lib/history";
import { month } from "./TimelineBar";

type Props = { data: HistoryData; tree: Tree; t: number; name: string };

const css = (el: Element, v: string) =>
  getComputedStyle(el).getPropertyValue(v).trim();

/**
 * The repo's file tree, drawn as it was at time t: folders branch out from the
 * repo in the middle, every file is a dot in its language's color, files added
 * in this stretch of history sprout out of their folder, edited ones get an
 * ochre ring, deleted ones fade.
 */
export default function HistoryTree({ data, tree, t, name }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [hover, setHover] = useState<{
    id: number;
    x: number;
    y: number;
  } | null>(null);
  const screen = useRef<{ ids: number[]; xs: number[]; ys: number[] }>({
    ids: [],
    xs: [],
    ys: [],
  });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth, h: el.clientHeight }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const last = data.frames.length - 1;
  const i = Math.max(0, Math.min(last, Math.floor(t)));
  const j = Math.min(last, i + 1);
  const f = t - i;

  // Languages that matter at the end, for the legend.
  const legend = useMemo(() => {
    const by = new Map<string, number>();
    data.langs.forEach((l, k) =>
      by.set(l, (by.get(l) || 0) + data.sizes[k][last]),
    );
    return [...by]
      .filter(([l]) => l !== "Other")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([l]) => l);
  }, [data, last]);

  // Only folders big enough to matter get a name on the tree.
  const named = useMemo(() => {
    const min = Math.max(3, data.paths.length * 0.02);
    const out = new Set<number>();
    for (const id of tree.nodes[0].children) {
      const n = tree.nodes[id];
      if (
        n.file < 0 &&
        data.paths.filter((p) => p.startsWith(n.path)).length >= min
      )
        out.add(id);
    }
    return out;
  }, [tree, data]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = size;
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
    if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const line = css(c, "--line-2");
    const muted = css(c, "--text-3");
    const text2 = css(c, "--text-2");
    const accent = css(c, "--accent");
    const bg = css(c, "--canvas");

    const reach = tree.extent[i] + (tree.extent[j] - tree.extent[i]) * f;
    const k = Math.min(
      (w / 2 - (w < 600 ? 28 : 110)) / reach,
      (h / 2 - (w < 600 ? 60 : 28)) / reach,
    );
    const cx = w / 2;
    const cy = h / 2 + 6;
    const nodes = tree.nodes;
    const pos: ({ x: number; y: number; a: number; born: boolean } | null)[] =
      nodes.map((_, id) => at(tree, id, t));
    const X = (id: number) => cx + pos[id]!.x * k;
    const Y = (id: number) => cy + pos[id]!.y * k;

    // branches
    g.lineWidth = 1;
    g.strokeStyle = line;
    for (let id = 1; id < nodes.length; id++) {
      const p = pos[id];
      const q = pos[nodes[id].parent];
      if (!p || !q) continue;
      g.globalAlpha = 0.75 * p.a;
      g.beginPath();
      g.moveTo(X(nodes[id].parent), Y(nodes[id].parent));
      g.lineTo(X(id), Y(id));
      g.stroke();
    }

    // folders
    g.fillStyle = muted;
    for (let id = 0; id < nodes.length; id++) {
      if (nodes[id].file >= 0 || !pos[id]) continue;
      g.globalAlpha = pos[id]!.a;
      g.beginPath();
      g.arc(X(id), Y(id), id === 0 ? 4 : 2.2, 0, Math.PI * 2);
      g.fill();
    }

    // files, then what happened to them in this stretch
    const ids: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    const pulse = Math.sin(Math.PI * f);
    for (let id = 0; id < nodes.length; id++) {
      const n = nodes[id];
      const p = pos[id];
      if (n.file < 0 || !p) continue;
      const s = data.sizes[n.file];
      const lines = lerp(s, t) || s[i] || s[j];
      const r = Math.max(2, Math.min(8, 1.4 + Math.sqrt(lines) / 7));
      const x = X(id);
      const y = Y(id);
      g.globalAlpha = p.a;
      g.fillStyle = langColor(data.langs[n.file]);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      const added = p.born;
      const edited = !added && s[i] > 0 && s[j] > 0 && s[i] !== s[j];
      if ((added || edited) && i !== j) {
        g.globalAlpha = added ? 1 - f : pulse;
        g.strokeStyle = accent;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, y, r + 2 + (added ? 0 : 2 * f), 0, Math.PI * 2);
        g.stroke();
      }
      ids.push(id);
      xs.push(x);
      ys.push(y);
    }
    screen.current = { ids, xs, ys };

    // top-level folder names, with a halo so branches don't cut through them
    g.globalAlpha = 1;
    g.font = `500 12.5px ${css(c, "--mono") || "monospace"}`;
    g.textBaseline = "middle";
    g.lineWidth = 4;
    g.strokeStyle = bg;
    for (const id of nodes[0].children) {
      const p = pos[id];
      if (!p || !named.has(id)) continue;
      const x = X(id);
      const y = Y(id);
      const right = x >= cx;
      g.textAlign = right ? "left" : "right";
      g.globalAlpha = p.a;
      const label = nodes[id].name + "/";
      const lx = x + (right ? 8 : -8);
      g.strokeText(label, lx, y - 8);
      g.fillStyle = text2;
      g.fillText(label, lx, y - 8);
    }
    g.globalAlpha = 1;
    g.textAlign = "center";
    g.fillStyle = text2;
    g.strokeText(name, cx, cy - 16);
    g.fillText(name, cx, cy - 16);
  }, [tree, data, t, i, j, f, size, name, named]);

  const onMove = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const { ids, xs, ys } = screen.current;
    let best = -1;
    let bd = 100; // 10px
    for (let q = 0; q < ids.length; q++) {
      const d = (xs[q] - mx) ** 2 + (ys[q] - my) ** 2;
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    setHover(best >= 0 ? { id: ids[best], x: xs[best], y: ys[best] } : null);
  };

  const fr = data.frames[Math.round(t)];
  const period = data.frames[j].commits;
  // The latest commit of the stretch being played, one per stretch so it can be read.
  const ticker = i !== j && period.length ? period[0] : null;
  const release = data.releases.find(
    (r) => r.date > data.frames[i].date && r.date <= data.frames[j].date,
  );
  const hn = hover ? tree.nodes[hover.id] : null;
  const hl = hn ? Math.round(lerp(data.sizes[hn.file], t)) : 0;

  return (
    <div
      className="htree"
      ref={box}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <canvas
        ref={canvas}
        style={{ width: size.w, height: size.h }}
        aria-label={`File tree of ${name} in ${month(fr.date)}`}
      />
      <div className="htree-hud">
        <span className="htree-date">{month(fr.date)}</span>
        <span className="htree-count">
          {shortNumber(fr.files)} files ·{" "}
          {shortNumber(
            Math.round(
              lerp(
                data.frames.map((x) => x.lines),
                t,
              ),
            ),
          )}{" "}
          lines
        </span>
        {release && (
          <span className="htree-release">Released {release.tag}</span>
        )}
      </div>
      {ticker && (
        <p className="htree-ticker" key={ticker.sha}>
          <strong>{ticker.author}</strong> {ticker.message}
        </p>
      )}
      <div className="htree-legend">
        {legend.map((l) => (
          <span key={l}>
            <i style={{ background: langColor(l) }} />
            {l}
          </span>
        ))}
        <span>
          <i className="ring" />
          Added or edited
        </span>
      </div>
      {hn && (
        <div
          className="htree-tip"
          style={{
            left: Math.min(hover!.x + 12, size.w - 260),
            top: Math.max(8, hover!.y - 44),
          }}
        >
          <strong>{hn.path}</strong>
          <span>
            {hl ? `${shortNumber(hl)} lines` : "Not there at this point"}
          </span>
        </div>
      )}
    </div>
  );
}
