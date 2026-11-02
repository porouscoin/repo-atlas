"use client";

import { hierarchy, pack, type HierarchyCircularNode } from "d3-hierarchy";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import type { Snapshot } from "@/lib/api";
import { langColor } from "@/lib/colors";

type Datum = { name: string; path: string; i?: number; lang?: string; value?: number; children?: Datum[] };
type PNode = HierarchyCircularNode<Datum>;

const SIZE = 1000;

function buildTree(s: Snapshot): Datum {
  const root: Datum = { name: s.slug.split("/")[1], path: "", children: [] };
  const folders = new Map<string, Datum>([["", root]]);
  const folder = (path: string): Datum => {
    const hit = folders.get(path);
    if (hit) return hit;
    const parent = folder(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
    const d: Datum = { name: path.split("/").pop()!, path: path + "/", children: [] };
    parent.children!.push(d);
    folders.set(path, d);
    return d;
  };
  s.files.forEach((f, i) => {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
    folder(dir).children!.push({ name: f.path.split("/").pop()!, path: f.path, i, lang: f.lang, value: f.loc + 4 });
  });
  return root;
}

type Props = {
  snapshot: Snapshot;
  highlight: Set<number> | null;
  selected: number | null;
  zoomTo: { target: string; key: number } | null;
  onHover: (i: number | null, x: number, y: number) => void;
  onSelect: (i: number | null) => void;
};

export default function SizeView({ snapshot, highlight, selected, zoomTo, onHover, onSelect }: Props) {
  const root = useMemo(() => {
    const h = hierarchy(buildTree(snapshot))
      .sum((d) => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));
    return pack<Datum>().size([SIZE, SIZE]).padding((d) => (d.depth === 0 ? 6 : 2.5))(h);
  }, [snapshot]);

  const byPath = useMemo(() => {
    const m = new Map<string, PNode>();
    root.each((d) => m.set(d.data.path, d));
    return m;
  }, [root]);

  const [focus, setFocus] = useState<PNode>(root);
  const [view, setView] = useState({ x: root.x, y: root.y, r: root.r });
  const viewRef = useRef(view);
  viewRef.current = view;
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => setFocus(root), [root]);

  // Animate the viewBox towards the focused circle.
  useEffect(() => {
    const from = { ...viewRef.current };
    const to = { x: focus.x, y: focus.y, r: focus.r * 1.04 };
    const t0 = performance.now();
    let raf = 0;
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 700);
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      setView({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, r: from.r + (to.r - from.r) * k });
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [focus]);

  useEffect(() => {
    if (!zoomTo) return;
    let node = byPath.get(zoomTo.target) || byPath.get(zoomTo.target.replace(/\/?$/, "/"));
    if (!zoomTo.target) node = root;
    if (node && !node.children) node = node.parent || root; // a file: show its folder
    if (node) setFocus(node);
  }, [zoomTo, byPath, root]);

  const labels = (focus.children || []).filter((d) => d.children && d.r / focus.r > 0.06);

  return (
    <svg
      ref={svgRef}
      className="size-view"
      viewBox={`${view.x - view.r} ${view.y - view.r} ${view.r * 2} ${view.r * 2}`}
      preserveAspectRatio="xMidYMid meet"
      onClick={() => {
        onSelect(null);
        if (focus.parent) setFocus(focus.parent);
      }}
      onMouseLeave={() => onHover(null, 0, 0)}
    >
      <Circles
        root={root}
        highlight={highlight}
        onHover={(i, e) => {
          const rect = svgRef.current!.getBoundingClientRect();
          onHover(i, e.clientX - rect.left, e.clientY - rect.top);
        }}
        onFile={(i) => onSelect(i)}
        onFolder={(d) => setFocus(d)}
      />
      {selected !== null && byPath.get(snapshot.files[selected].path) && (
        <circle
          className="size-selected"
          cx={byPath.get(snapshot.files[selected].path)!.x}
          cy={byPath.get(snapshot.files[selected].path)!.y}
          r={byPath.get(snapshot.files[selected].path)!.r + view.r * 0.006}
          strokeWidth={view.r * 0.004}
        />
      )}
      <g className="size-labels" style={{ fontSize: view.r * 0.034 }}>
        {labels.map((d) => (
          <text key={d.data.path} x={d.x} y={d.y} textAnchor="middle" dominantBaseline="middle" strokeWidth={view.r * 0.008}>
            {d.data.name}
          </text>
        ))}
      </g>
    </svg>
  );
}

const Circles = memo(function Circles({
  root,
  highlight,
  onHover,
  onFile,
  onFolder,
}: {
  root: PNode;
  highlight: Set<number> | null;
  onHover: (i: number | null, e: React.MouseEvent) => void;
  onFile: (i: number) => void;
  onFolder: (d: PNode) => void;
}) {
  const nodes = root.descendants().slice(1);
  return (
    <g>
      {nodes.map((d) =>
        d.children ? (
          <circle
            key={d.data.path}
            className="size-folder"
            cx={d.x}
            cy={d.y}
            r={d.r}
            onClick={(e) => {
              e.stopPropagation();
              onFolder(d);
            }}
            onMouseMove={(e) => onHover(null, e)}
          >
            <title>{d.data.path}</title>
          </circle>
        ) : (
          <circle
            key={d.data.path}
            className="size-file"
            cx={d.x}
            cy={d.y}
            r={d.r}
            fill={langColor(d.data.lang || "Other")}
            opacity={highlight && !highlight.has(d.data.i!) ? 0.12 : 0.92}
            onMouseMove={(e) => onHover(d.data.i!, e)}
            onClick={(e) => {
              e.stopPropagation();
              onFile(d.data.i!);
            }}
          />
        ),
      )}
    </g>
  );
});

