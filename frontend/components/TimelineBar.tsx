"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Timeline } from "@/lib/api";
import { shortNumber } from "@/lib/graph";
import type { Box } from "@/lib/layout";
import { Pause, Play } from "./Icons";

export const month = (d: string) =>
  new Date(d).toLocaleDateString("en", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

// Muted, earthy band colors that sit on graphite and on paper; the ochre accent stays for highlights.
export const BAND = [
  "#6f9c7e",
  "#c26d48",
  "#8e70a6",
  "#c9ab4e",
  "#5b9b94",
  "#a7678a",
  "#7a9c5c",
  "#b08452",
  "#8e9397",
  "#ad5056",
  "#7891a8",
  "#a39d90",
];

type Props = {
  data: Timeline;
  boxes: Box[];
  t: number; // position in frames, fractional while playing
  playing: boolean;
  hover: number | null; // box index
  onSeek: (t: number) => void;
  onPlay: () => void;
  onHover: (k: number | null) => void;
};

type Pt = [number, number];

/** Smooth curve through points without overshoot (monotone cubic), so stacked bands never cross. */
function monotone(pts: Pt[]): string {
  const n = pts.length;
  if (n < 3)
    return pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join("");
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i][0]);
  const s = pts.slice(1).map((p, i) => (p[1] - pts[i][1]) / (dx[i] || 1));
  const m = pts.map((_, i) => {
    if (i === 0) return s[0];
    if (i === n - 1) return s[n - 2];
    return s[i - 1] * s[i] <= 0
      ? 0
      : (3 * (dx[i - 1] + dx[i])) /
          ((2 * dx[i] + dx[i - 1]) / s[i - 1] + (dx[i] + 2 * dx[i - 1]) / s[i]);
  });
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${pts[i][0] + h} ${pts[i][1] + m[i] * h} ${pts[i + 1][0] - h} ${pts[i + 1][1] - m[i + 1] * h} ${pts[i + 1][0]} ${pts[i + 1][1]}`;
  }
  return d;
}

export const lerp = (a: number[], t: number) => {
  const i = Math.floor(t);
  const f = t - i;
  return i + 1 < a.length ? a[i] + (a[i + 1] - a[i]) * f : a[a.length - 1];
};

/** Bands in order of appearance (oldest first), each with its color. */
export function riverBands(boxes: Box[], data: Timeline) {
  return boxes
    .map((b, k) => ({ k, b, s: data.boxes[b.id] }))
    .filter((x) => x.s && x.s.lines.some((v) => v > 0))
    .map((x) => ({ ...x, born: x.s.lines.findIndex((v) => v > 0) }))
    .sort((a, b) => a.born - b.born || b.b.loc - a.b.loc)
    .map((x, j) => ({ ...x, color: BAND[j % BAND.length] }));
}

/**
 * The history player: a "growth river" where each part of the folder is a band
 * whose thickness is its size at that point in time, oldest parts at the bottom
 * like layers of rock. The future is drawn faint, the past solid.
 */
export default function TimelineBar({
  data,
  boxes,
  t,
  playing,
  hover,
  onSeek,
  onPlay,
  onHover,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(800);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const frames = data.frames;
  const last = frames.length - 1;
  const i = Math.min(last, Math.round(t));
  const f = frames[i];
  const narrow = W < 560;
  const H = narrow ? 150 : 210;
  const LABEL = narrow ? 0 : 150; // room on the right for band labels

  const bands = useMemo(() => riverBands(boxes, data), [boxes, data]);

  const geo = useMemo(() => {
    const plotW = Math.max(100, W - LABEL);
    const x = (j: number) => (last ? (j / last) * plotW : 0);
    const totals = frames.map((_, j) =>
      bands.reduce((a, bd) => a + bd.s.lines[j], 0),
    );
    const max = Math.max(1, ...totals);
    const y = (v: number) => H - 4 - (v / max) * (H - 12);
    const cum = frames.map(() => 0);
    const shapes = bands.map((bd) => {
      const lo = cum.slice();
      bd.s.lines.forEach((v, j) => (cum[j] += v));
      const hi = cum.slice();
      const top = monotone(hi.map((v, j) => [x(j), y(v)] as Pt));
      const bottom = monotone(lo.map((v, j) => [x(j), y(v)] as Pt).reverse());
      return {
        ...bd,
        d: `${top}L${x(last)} ${y(lo[last])}${bottom.replace(/^M/, "L")}Z`,
        lo,
        hi,
      };
    });
    return { plotW, x, y, shapes, max };
  }, [W, LABEL, H, frames, bands, last]);

  const px = geo.x(Math.min(last, t));

  // Labels at the right edge, nudged apart so they never overlap.
  const labels = useMemo(() => {
    const out = geo.shapes
      .map((s) => ({
        k: s.k,
        name: s.b.kind === "folder" ? s.b.name + "/" : s.b.name,
        color: s.color,
        y: (geo.y(s.lo[last]) + geo.y(s.hi[last])) / 2,
      }))
      .sort((a, b) => b.y - a.y);
    // Bottom up, keep them apart; if that runs off the top, come back down.
    const gap = Math.min(17, (H - 18) / Math.max(1, out.length - 1));
    if (out.length) out[0].y = Math.min(out[0].y, H - 10);
    for (let j = 1; j < out.length; j++)
      out[j].y = Math.min(out[j].y, out[j - 1].y - gap);
    const n = out.length;
    if (n && out[n - 1].y < 8) {
      out[n - 1].y = 8;
      for (let j = n - 2; j >= 0; j--)
        out[j].y = Math.max(out[j].y, out[j + 1].y + gap);
    }
    return out;
  }, [geo, last, H]);

  const seek = (clientX: number) => {
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (clientX - r.left) / geo.plotW)) * last);
  };

  const years: { j: number; label: string }[] = [];
  frames.forEach((p, j) => {
    const yr = p.date.slice(0, 4);
    if (!years.length || years[years.length - 1].label !== yr)
      years.push({ j, label: yr });
  });
  const every = Math.ceil(years.length / (narrow ? 4 : 8));
  const tip =
    hover !== null ? geo.shapes.find((s) => s.k === hover) : undefined;
  const tipName = tip
    ? tip.b.kind === "folder"
      ? tip.b.name + "/"
      : tip.b.name
    : "";
  const tipLines = tip ? Math.round(lerp(tip.s.lines, t)) : 0;

  return (
    <div className="player" role="group" aria-label="History">
      <div className="player-head">
        <button
          className="play"
          onClick={onPlay}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <div className="player-when">
          <span className="player-date">{month(f.date)}</span>
          <span className="player-msg" title={f.message}>
            {f.message}
          </span>
          <span className="player-sub">
            {f.author} · commit {f.n.toLocaleString()} of{" "}
            {data.commits.toLocaleString()}
          </span>
        </div>
        <div className="player-size">
          <p>
            <strong>
              {shortNumber(
                Math.round(
                  lerp(
                    frames.map((p) => p.lines),
                    t,
                  ),
                ),
              )}
            </strong>{" "}
            lines
          </p>
          <span>{shortNumber(f.files)} files</span>
        </div>
      </div>

      <div
        className="river"
        ref={wrap}
        style={{ height: H }}
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          seek(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && seek(e.clientX)}
        onPointerLeave={() => onHover(null)}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={i}
        aria-valuetext={month(f.date)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onSeek(Math.max(0, i - 1));
          if (e.key === "ArrowRight") onSeek(Math.min(last, i + 1));
        }}
      >
        <svg width={W} height={H}>
          <defs>
            <clipPath id="river-past">
              <rect x={0} y={0} width={Math.max(0.01, px)} height={H} />
            </clipPath>
          </defs>
          {[0.5, 1].map((g) => (
            <line
              key={g}
              x1={0}
              x2={geo.plotW}
              y1={geo.y(geo.max * g)}
              y2={geo.y(geo.max * g)}
              className="river-grid"
            />
          ))}
          <g className="river-future">
            {geo.shapes.map((s) => (
              <path
                key={s.k}
                d={s.d}
                fill={s.color}
                onPointerEnter={() => onHover(s.k)}
              />
            ))}
          </g>
          <g clipPath="url(#river-past)" className="river-past">
            {geo.shapes.map((s) => (
              <path
                key={s.k}
                d={s.d}
                fill={s.color}
                className={`band ${hover === s.k ? "on" : ""} ${hover !== null && hover !== s.k ? "off" : ""}`}
                onPointerEnter={() => onHover(s.k)}
              />
            ))}
          </g>
          <line
            x1={0}
            x2={geo.plotW}
            y1={H - 4}
            y2={H - 4}
            className="river-base"
          />
          <line x1={px} x2={px} y1={0} y2={H} className="river-now" />
          {LABEL > 0 &&
            labels.map((l) => (
              <g
                key={l.k}
                className={`river-label ${hover === l.k ? "on" : ""}`}
                onPointerEnter={() => onHover(l.k)}
              >
                <rect
                  x={geo.plotW + 12}
                  y={l.y - 4}
                  width={8}
                  height={8}
                  rx={2}
                  fill={l.color}
                />
                <text x={geo.plotW + 26} y={l.y + 4.5}>
                  {l.name.length > 16 ? l.name.slice(0, 15) + "…" : l.name}
                </text>
              </g>
            ))}
        </svg>
        {tip && (
          <div
            className="river-tip"
            style={{ left: Math.max(4, Math.min(px + 12, geo.plotW - 180)) }}
          >
            <strong>{tipName}</strong>
            <span>
              {tipLines
                ? `${shortNumber(tipLines)} lines in ${month(f.date)}`
                : `Not there yet in ${month(f.date)}`}
            </span>
          </div>
        )}
      </div>
      <div className="track-years" style={{ width: geo.plotW }}>
        {years
          .filter((_, k) => k % every === 0)
          .map((yr) => (
            <span key={yr.j} style={{ left: geo.x(yr.j) }}>
              {yr.label}
            </span>
          ))}
      </div>
    </div>
  );
}
