"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { langColor } from "@/lib/colors";
import { shortNumber } from "@/lib/graph";
import { CARD_H, CARD_W, GAP_X, GAP_Y, layout, simplify, type Box, type Link, type Placed } from "@/lib/layout";

type Props = {
  boxes: Box[];
  links: Link[];
  roles: Record<string, string> | null;
  start: string;
  selected: number | null;
  lit: Set<number> | null; // boxes the AI pointed at
  onOpen: (b: Box, k: number) => void;
};

const PAD = 48;
const MARGIN_LANE = 14; // spacing of back links running down the right margin

type Pt = [number, number];
type Route = { points: Pt[]; back: boolean; label: Pt };

export default function Diagram({ boxes, links: allLinks, roles, start, selected, lit, onOpen }: Props) {
  const { shown: links, hidden } = useMemo(() => simplify(allLinks, boxes.length), [allLinks, boxes.length]);
  const wrap = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(1200);
  // Narrow screens get fewer boxes per row instead of a tiny diagram.
  const perRow = avail < 520 ? 1 : avail < 820 ? 2 : 3;
  const lay = useMemo(() => layout(boxes, links, perRow), [boxes, links, perRow]);
  const routes = useMemo(() => route(links, lay.boxes, lay.width), [links, lay]);
  const backCount = routes.filter((r) => r.back).length;

  const [hover, setHover] = useState<number | null>(null);
  const [hoverLink, setHoverLink] = useState<number | null>(null);
  const [fit, setFit] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null); // null = fit to width

  const W = lay.width + PAD * 2 + (backCount ? 24 + backCount * MARGIN_LANE : 0);
  const H = lay.height + PAD * 2;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      setAvail(el.clientWidth);
      setFit(Math.max(0.5, Math.min(1, (el.clientWidth - 8) / W)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W]);
  const scale = zoom ?? fit;
  const step = (d: number) => setZoom(Math.round(Math.max(0.4, Math.min(1.6, scale + d)) * 10) / 10);

  const focus = hover ?? selected;
  const near = useMemo(() => {
    if (focus === null) return null;
    const s = new Set([focus]);
    for (const l of links) {
      if (l.from === focus) s.add(l.to);
      if (l.to === focus) s.add(l.from);
    }
    return s;
  }, [focus, links]);

  const maxCount = Math.max(1, ...links.map((l) => l.count));

  return (
    <div className="diagram-wrap" ref={wrap}>
      {hidden > 0 && (
        <p className="hidden-note">
          Showing the main links. {hidden} weaker or reverse link{hidden === 1 ? " is" : "s are"} hidden.
        </p>
      )}
      <div className="diagram" style={{ width: W * scale, height: H * scale }}>
        <div style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "0 0", position: "relative" }}>
          <svg className="arrows" width={W} height={H}>
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto">
                <path d="M0 1L10 5L0 9z" fill="context-stroke" />
              </marker>
            </defs>
            {links.map((l, k) => {
              const r = routes[k];
              const d = rounded(r.points, 10);
              const active = focus !== null && (l.from === focus || l.to === focus);
              const dim = focus !== null && !active;
              const showLabel = hoverLink === k || (hover !== null && active && links.filter((x) => x.from === hover || x.to === hover).length <= 3);
              return (
                <g key={k} className={`link ${active ? "active" : ""} ${dim ? "dim" : ""} ${r.back ? "back" : ""}`}>
                  <path d={d} className="hit" onMouseEnter={() => setHoverLink(k)} onMouseLeave={() => setHoverLink(null)} />
                  <path d={d} className="line" strokeWidth={1.4 + (l.count / maxCount) * 2.6} markerEnd="url(#arrow)" />
                  {showLabel && (
                    <text x={r.label[0]} y={r.label[1]} className="link-label" textAnchor="middle">
                      {boxes[l.from].name} uses {boxes[l.to].name} · {l.count} import{l.count === 1 ? "" : "s"}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {lay.looseRowY !== null && (
            <div className="loose-label" style={{ top: PAD + lay.looseRowY, left: PAD, width: lay.width }}>
              <span>Not linked by imports</span>
            </div>
          )}

          {boxes.map((b, k) => {
            const p = lay.boxes[k];
            const dim = (near && !near.has(k)) || (lit && !lit.has(k));
            const color = b.kind === "group" ? "var(--line-2)" : langColor(b.langs[0]?.lang || "Other");
            return (
              <button
                key={b.id}
                className={`card ${b.kind} ${selected === k ? "selected" : ""} ${dim ? "dim" : ""} ${lit?.has(k) ? "lit" : ""}`}
                style={{ left: PAD + p.x, top: PAD + p.y, width: CARD_W, height: CARD_H, ["--card-color" as string]: color }}
                onMouseEnter={() => setHover(k)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onOpen(b, k)}
              >
                <div className="card-top">
                  <span className="card-name">{b.kind === "folder" ? `${b.name}/` : b.name}</span>
                  {start === b.name && <span className="start-tag">Start here</span>}
                </div>
                <p className={`card-role ${roles ? "" : "loading"}`}>
                  {roles ? roles[b.name] || (b.parts ? b.parts.slice(0, 4).join(", ") + "…" : "") : "Reading…"}
                </p>
                <div className="card-meta">
                  <span>
                    {b.files.length === 1 ? "1 file" : `${shortNumber(b.files.length)} files`} · {shortNumber(b.loc)} lines
                    {b.langs[0] && b.kind !== "group" ? ` · ${b.langs[0].lang}` : ""}
                  </span>
                  {b.kind === "folder" && <span className="open-hint">Open →</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="zoom" role="group" aria-label="Zoom">
        <button onClick={() => step(-0.1)} aria-label="Zoom out">
          −
        </button>
        <button className="pct" onClick={() => setZoom(1)} title="Actual size">
          {Math.round(scale * 100)}%
        </button>
        <button onClick={() => step(0.1)} aria-label="Zoom in">
          +
        </button>
        <button onClick={() => setZoom(null)} title="Fit to the window">
          Fit
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ routing

/*
 * Right-angle connectors, like a diagram editor draws them. Every arrow leaves
 * the bottom of a card and enters the top of another. Horizontal runs sit in
 * the gaps between rows (each arrow in its own lane), arrows that skip rows
 * drop through a gap between cards, and arrows pointing back up run along the
 * right margin, dashed.
 */
function route(links: Link[], placed: Placed[], width: number): Route[] {
  const rowTop = new Map<number, number>();
  for (const p of placed) rowTop.set(p.row, PAD + p.y);
  const gapY = (row: number) => {
    // centre of the gap below `row`; row -1 is the space above the first row
    if (row < 0) return PAD / 2;
    const next = rowTop.get(row + 1);
    const bottom = (rowTop.get(row) ?? 0) + CARD_H;
    return next !== undefined && next - bottom < GAP_Y * 1.5 ? (bottom + next) / 2 : bottom + GAP_Y / 2;
  };

  // Spread arrow ends along each card edge, ordered by where the other end is.
  const ends = new Map<string, number>();
  const spread = (side: "from" | "to") => {
    const by = new Map<number, number[]>();
    links.forEach((l, k) => by.set(l[side], [...(by.get(l[side]) || []), k]));
    const other = side === "from" ? "to" : "from";
    for (const ks of by.values()) {
      ks.sort((a, b) => placed[links[a][other]].x - placed[links[b][other]].x);
      ks.forEach((k, j) => ends.set(`${side}${k}`, ((j + 1) / (ks.length + 1) - 0.5) * CARD_W * 0.6));
    }
  };
  spread("from");
  spread("to");

  // Plan each route by the gaps it uses, then give every user of a gap its own lane.
  type Plan = { k: number; x1: number; y1: number; x2: number; y2: number; back: boolean; gaps: number[]; channel: number | null };
  const plans: Plan[] = links.map((l, k) => {
    const a = placed[l.from];
    const b = placed[l.to];
    const x1 = PAD + a.x + CARD_W / 2 + (ends.get(`from${k}`) || 0);
    const y1 = PAD + a.y + CARD_H;
    const x2 = PAD + b.x + CARD_W / 2 + (ends.get(`to${k}`) || 0);
    const y2 = PAD + b.y;
    if (b.row <= a.row) return { k, x1, y1, x2, y2, back: true, gaps: [a.row, b.row - 1], channel: null };
    if (b.row === a.row + 1) return { k, x1, y1, x2, y2, back: false, gaps: [a.row], channel: null };
    // Skips rows: is the straight drop at x2 clear of the cards in between?
    const between = placed.filter((p, i) => i !== l.from && i !== l.to && p.row > a.row && p.row < b.row);
    const hits = (x: number) => between.some((p) => x > PAD + p.x - 10 && x < PAD + p.x + CARD_W + 10);
    if (!hits(x2)) return { k, x1, y1, x2, y2, back: false, gaps: [a.row], channel: null };
    const options = between.flatMap((p) => [PAD + p.x - GAP_X / 2, PAD + p.x + CARD_W + GAP_X / 2]).filter((x) => !hits(x));
    const channel = options.sort((m, n) => Math.abs(m - x1) + Math.abs(m - x2) - (Math.abs(n - x1) + Math.abs(n - x2)))[0];
    return { k, x1, y1, x2, y2, back: false, gaps: [a.row, b.row - 1], channel: channel ?? PAD - GAP_X / 2 };
  });

  const lanes = new Map<string, number>();
  const users = new Map<number, Plan[]>();
  for (const p of plans) for (const g of p.gaps) users.set(g, [...(users.get(g) || []), p]);
  for (const [g, ps] of users) {
    ps.sort((m, n) => (m.x1 + m.x2) / 2 - (n.x1 + n.x2) / 2);
    const space = Math.min(12, (GAP_Y - 36) / Math.max(1, ps.length - 1));
    ps.forEach((p, j) => lanes.set(`${p.k}:${g}`, (j - (ps.length - 1) / 2) * space));
  }
  const laneY = (p: Plan, g: number) => gapY(g) + (lanes.get(`${p.k}:${g}`) || 0);

  let margin = 0;
  return plans.map((p) => {
    const ya = laneY(p, p.gaps[0]);
    if (p.back) {
      const mx = PAD + width + 24 + margin++ * MARGIN_LANE;
      const yb = laneY(p, p.gaps[1]);
      return {
        back: true,
        points: [[p.x1, p.y1], [p.x1, ya], [mx, ya], [mx, yb], [p.x2, yb], [p.x2, p.y2]],
        label: [mx - 8, (ya + yb) / 2],
      };
    }
    if (p.channel === null) {
      const straight = Math.abs(p.x1 - p.x2) < 1;
      return {
        back: false,
        points: [[p.x1, p.y1], [p.x1, ya], [p.x2, ya], [p.x2, p.y2]],
        label: straight ? [p.x1, (p.y1 + p.y2) / 2 + 5] : [(p.x1 + p.x2) / 2, ya - 8],
      };
    }
    const yb = laneY(p, p.gaps[1]);
    return {
      back: false,
      points: [[p.x1, p.y1], [p.x1, ya], [p.channel, ya], [p.channel, yb], [p.x2, yb], [p.x2, p.y2]],
      label: [(p.x1 + p.channel) / 2, ya - 8],
    };
  });
}

// A polyline with its corners rounded off.
function rounded(points: Pt[], r: number): string {
  const pts = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const rr = Math.min(r, inLen / 2, outLen / 2);
    if (rr < 0.5) {
      d += ` L${cx} ${cy}`;
      continue;
    }
    const ax = cx - ((cx - px) / inLen) * rr;
    const ay = cy - ((cy - py) / inLen) * rr;
    const bx = cx + ((nx - cx) / outLen) * rr;
    const by = cy + ((ny - cy) / outLen) * rr;
    d += ` L${ax} ${ay} Q${cx} ${cy} ${bx} ${by}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last[0]} ${last[1]}`;
}
