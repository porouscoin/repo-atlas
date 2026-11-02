"use client";

import { useRef } from "react";

import type { Timeline } from "@/lib/api";
import { shortNumber } from "@/lib/graph";
import { Pause, Play } from "./Icons";

export const month = (d: string) =>
  new Date(d).toLocaleDateString("en", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

type Props = {
  data: Timeline;
  frame: number;
  playing: boolean;
  onFrame: (f: number) => void;
  onPlay: () => void;
};

/** The player under the diagram: play button, the commit it's showing, and a scrubber over a chart of total size. */
export default function TimelineBar({
  data,
  frame,
  playing,
  onFrame,
  onPlay,
}: Props) {
  const track = useRef<HTMLDivElement>(null);
  const frames = data.frames;
  const f = frames[frame];
  const last = frames.length - 1;
  const max = Math.max(1, ...frames.map((x) => x.lines));
  const x = (i: number) => (last ? (i / last) * 1000 : 0);
  const y = (v: number) => 52 - (v / max) * 48;
  const line = frames
    .map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(p.lines)}`)
    .join(" ");
  const done = frames
    .slice(0, frame + 1)
    .map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(p.lines)}`)
    .join(" ");
  const area = `${done} L${x(frame)} 56 L0 56 Z`;

  // A label at each new year, thinned out so they never crowd.
  const years: { i: number; label: string }[] = [];
  frames.forEach((p, i) => {
    const yr = p.date.slice(0, 4);
    if (!years.length || years[years.length - 1].label !== yr)
      years.push({ i, label: yr });
  });
  const every = Math.ceil(years.length / 8);
  const shownYears = years.filter((_, k) => k % every === 0);

  const pick = (clientX: number) => {
    const el = track.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    onFrame(Math.round(t * last));
  };

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
            <strong>{shortNumber(f.lines)}</strong> lines
          </p>
          <span>{shortNumber(f.files)} files</span>
        </div>
      </div>
      <div
        className="track"
        ref={track}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          pick(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && pick(e.clientX)}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={frame}
        aria-valuetext={month(f.date)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onFrame(Math.max(0, frame - 1));
          if (e.key === "ArrowRight") onFrame(Math.min(last, frame + 1));
        }}
      >
        <svg viewBox="0 0 1000 56" preserveAspectRatio="none" aria-hidden>
          <path
            d={line}
            className="track-line"
            vectorEffect="non-scaling-stroke"
          />
          <path d={area} className="track-area" />
          <path
            d={done}
            className="track-done"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="track-now"
          style={{ left: `${(x(frame) / 1000) * 100}%` }}
        />
      </div>
      <div className="track-years">
        {shownYears.map((yr) => (
          <span key={yr.i} style={{ left: `${(x(yr.i) / 1000) * 100}%` }}>
            {yr.label}
          </span>
        ))}
      </div>
    </div>
  );
}
