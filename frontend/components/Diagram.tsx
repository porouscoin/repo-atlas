"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { langColor } from "@/lib/colors";
import { shortNumber } from "@/lib/graph";
import { CARD_H, CARD_W, layout, simplify, type Box, type Link } from "@/lib/layout";

type Props = {
  boxes: Box[];
  links: Link[];
  roles: Record<string, string> | null;
  start: string;
  selected: number | null;
  lit: Set<number> | null; // boxes the AI pointed at
  onOpen: (b: Box, k: number) => void;
};

const PAD = 40;

export default function Diagram({ boxes, links: allLinks, roles, start, selected, lit, onOpen }: Props) {
  const { shown: links, hidden } = useMemo(() => simplify(allLinks, boxes.length), [allLinks, boxes.length]);
  const lay = useMemo(() => layout(boxes, links), [boxes, links]);
  const [hover, setHover] = useState<number | null>(null);
  const [hoverLink, setHoverLink] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, (el.clientWidth - 24) / (lay.width + PAD * 2)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [lay.width]);

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

  // Spread arrow ends along each card's edge, ordered by where the other end is.
  const ports = useMemo(() => {
    const outs = new Map<number, number[]>();
    const ins = new Map<number, number[]>();
    links.forEach((l, k) => {
      if (lay.boxes[l.to].y <= lay.boxes[l.from].y) return; // side-routed back links
      outs.set(l.from, [...(outs.get(l.from) || []), k]);
      ins.set(l.to, [...(ins.get(l.to) || []), k]);
    });
    const at = new Map<string, number>();
    const spread = (m: Map<number, number[]>, side: "from" | "to") => {
      for (const ks of m.values()) {
        const other = side === "from" ? "to" : "from";
        ks.sort((a, b) => lay.boxes[links[a][other]].x - lay.boxes[links[b][other]].x);
        ks.forEach((k, j) => at.set(`${side}${k}`, ((j + 1) / (ks.length + 1) - 0.5) * CARD_W * 0.7));
      }
    };
    spread(outs, "from");
    spread(ins, "to");
    return at;
  }, [links, lay]);
  const W = lay.width + PAD * 2;
  const H = lay.height + PAD * 2;

  return (
    <div className="diagram-wrap" ref={wrap}>
      <div className="diagram" style={{ width: W * scale, height: H * scale }}>
        <div style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "0 0", position: "relative" }}>
          <svg className="arrows" width={W} height={H}>
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" fill="context-stroke" />
              </marker>
            </defs>
            {links.map((l, k) => {
              const a = lay.boxes[l.from];
              const b = lay.boxes[l.to];
              const down = b.y > a.y;
              const x1 = PAD + a.x + CARD_W / 2 + (down ? ports.get(`from${k}`) || 0 : CARD_W / 2);
              const y1 = PAD + a.y + (down ? CARD_H : CARD_H / 2);
              const x2 = PAD + b.x + CARD_W / 2 + (down ? ports.get(`to${k}`) || 0 : CARD_W / 2);
              const y2 = PAD + b.y + (down ? 0 : CARD_H / 2);
              const d = down
                ? `M${x1} ${y1} C${x1} ${y1 + 40} ${x2} ${y2 - 40} ${x2} ${y2 - 2}`
                : `M${x1} ${y1} C${x1 + 70} ${y1} ${x2 + 70} ${y2} ${x2 + 2} ${y2}`;
              const active = focus !== null && (l.from === focus || l.to === focus);
              const dim = focus !== null && !active;
              return (
                <g key={k} className={`link ${active ? "active" : ""} ${dim ? "dim" : ""} ${down ? "" : "back"}`}>
                  <path d={d} className="hit" onMouseEnter={() => setHoverLink(k)} onMouseLeave={() => setHoverLink(null)} />
                  <path d={d} className="line" strokeWidth={1.2 + (l.count / maxCount) * 3.2} markerEnd="url(#arrow)" />
                  {(active || hoverLink === k) && (
                    <text x={(x1 + x2) / 2 + (down ? 8 : 74)} y={(y1 + y2) / 2} className="link-label">
                      {boxes[l.from].name} uses {boxes[l.to].name} · {l.count} import{l.count === 1 ? "" : "s"}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {hidden > 0 && (
            <p className="hidden-note" style={{ top: 8, left: PAD, width: lay.width }}>
              Showing the main links. {hidden} weaker or reverse link{hidden === 1 ? " is" : "s are"} hidden.
            </p>
          )}
          {lay.looseRowY !== null && (
            <div className="loose-label" style={{ top: PAD + lay.looseRowY, left: PAD, width: lay.width }}>
              <span>Not linked by imports</span>
            </div>
          )}

          {boxes.map((b, k) => {
            const p = lay.boxes[k];
            const total = b.langs.reduce((a, l) => a + l.loc, 0) || 1;
            const dim = (near && !near.has(k)) || (lit && !lit.has(k));
            return (
              <button
                key={b.id}
                className={`card ${b.kind} ${selected === k ? "selected" : ""} ${dim ? "dim" : ""} ${lit?.has(k) ? "lit" : ""}`}
                style={{ left: PAD + p.x, top: PAD + p.y, width: CARD_W, height: CARD_H }}
                onMouseEnter={() => setHover(k)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onOpen(b, k)}
              >
                <div className="card-top">
                  <span className="card-name">
                    {b.kind === "folder" ? `${b.name}/` : b.name}
                  </span>
                  {start === b.name && <span className="start-tag">Start here</span>}
                </div>
                <p className={`card-role ${roles ? "" : "loading"}`}>
                  {roles ? roles[b.name] || (b.parts ? b.parts.slice(0, 4).join(", ") + "…" : "") : "Reading…"}
                </p>
                <div className="card-meta">
                  <span>
                    {b.files.length === 1 ? "1 file" : `${shortNumber(b.files.length)} files`} · {shortNumber(b.loc)} lines
                  </span>
                  {b.kind === "folder" && <span className="open-hint">Open →</span>}
                </div>
                <div className="lang-bar">
                  {b.langs.map((l) => (
                    <i key={l.lang} style={{ width: `${(l.loc / total) * 100}%`, background: langColor(l.lang) }} title={l.lang} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
