"use client";

import { useEffect, useRef, useState } from "react";

import { Pause, Play } from "./Icons";

export const month = (d: string) =>
  new Date(d).toLocaleDateString("en", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

type Props = {
  frames: { date: string; lines: number }[];
  releases: { tag: string; date: string }[];
  t: number; // position in frames, fractional while playing
  playing: boolean;
  onSeek: (t: number) => void;
  onPlay: () => void;
};

/** Play button and a scrubber drawn over the repo's total size, with releases marked. */
export default function TimelineBar({
  frames,
  releases,
  t,
  playing,
  onSeek,
  onPlay,
}: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const last = frames.length - 1;
  const H = 44;
  const max = Math.max(1, ...frames.map((f) => f.lines));
  const x = (j: number) => (last ? (j / last) * W : 0);
  const y = (v: number) => H - 2 - (v / max) * (H - 6);
  const line = frames
    .map((f, j) => `${j ? "L" : "M"}${x(j)} ${y(f.lines)}`)
    .join("");
  const area = `${line}L${W} ${H}L0 ${H}Z`;
  const px = x(Math.min(last, t));

  // A release sits between the two sampled commits around its date.
  const when = (date: string) => {
    for (let j = 0; j < last; j++) {
      const a = Date.parse(frames[j].date);
      const b = Date.parse(frames[j + 1].date);
      const d = Date.parse(date);
      if (d >= a && d <= b) return x(j + (b > a ? (d - a) / (b - a) : 0));
    }
    return null;
  };
  // With many releases, mark only the first of each minor (or major) version.
  const key = (tag: string, depth: number) =>
    tag.replace(/^v/, "").split(/[.-]/).slice(0, depth).join(".");
  let main = releases;
  for (const depth of [2, 1]) {
    if (main.length <= 12) break;
    main = main.filter(
      (r, k) => k === 0 || key(r.tag, depth) !== key(main[k - 1].tag, depth),
    );
  }
  const marks = main
    .map((r) => ({ ...r, x: when(r.date) }))
    .filter((r) => r.x !== null) as { tag: string; date: string; x: number }[];
  const labelled = marks.filter((m, k) => k === 0 || m.x - marks[k - 1].x > 46);

  const years: { j: number; label: string }[] = [];
  frames.forEach((f, j) => {
    const yr = f.date.slice(0, 4);
    if (!years.length || years[years.length - 1].label !== yr)
      years.push({ j, label: yr });
  });
  // Years sit unevenly (points are spaced by commits), so thin them by distance.
  const shownYears: typeof years = [];
  for (const yr of years)
    if (
      !shownYears.length ||
      x(yr.j) - x(shownYears[shownYears.length - 1].j) >= 44
    )
      shownYears.push(yr);

  const seek = (clientX: number) => {
    const el = track.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * last);
  };
  const i = Math.round(t);

  return (
    <div className="player" role="group" aria-label="History">
      <button
        className="play"
        onClick={onPlay}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <div className="scrub">
        <div
          className="track"
          ref={track}
          onPointerDown={(e) => {
            (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
            seek(e.clientX);
          }}
          onPointerMove={(e) => e.buttons === 1 && seek(e.clientX)}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={i}
          aria-valuetext={month(frames[i].date)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") onSeek(Math.max(0, i - 1));
            if (e.key === "ArrowRight") onSeek(Math.min(last, i + 1));
          }}
        >
          <svg width={W} height={H} aria-hidden>
            <defs>
              <clipPath id="scrub-past">
                <rect x={0} y={0} width={Math.max(0.01, px)} height={H} />
              </clipPath>
            </defs>
            <path d={area} className="track-area" />
            <path d={line} className="track-line" />
            <path
              d={area}
              className="track-area on"
              clipPath="url(#scrub-past)"
            />
            <path d={line} className="track-done" clipPath="url(#scrub-past)" />
            {marks.map((m) => (
              <line
                key={m.tag + m.date}
                x1={m.x}
                x2={m.x}
                y1={0}
                y2={H}
                className="track-release"
              />
            ))}
            <line x1={px} x2={px} y1={-4} y2={H + 4} className="track-now" />
          </svg>
          {labelled.map((m) => (
            <span
              key={m.tag + m.date}
              className="release-tag"
              style={{ left: m.x }}
            >
              {m.tag}
            </span>
          ))}
        </div>
        <div className="track-years">
          {shownYears.map((yr) => (
            <span key={yr.j} style={{ left: x(yr.j) }}>
              {yr.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
