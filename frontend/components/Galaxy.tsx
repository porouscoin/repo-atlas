"use client";

import { useEffect, useRef } from "react";

import type { Snapshot } from "@/lib/api";
import { GalaxyEngine } from "@/lib/galaxy";
import type { Graph } from "@/lib/graph";

type Props = {
  snapshot: Snapshot;
  graph: Graph;
  highlight: Set<number> | null;
  visible: Uint8Array | null;
  selected: number | null;
  onReady: (engine: GalaxyEngine | null) => void;
  onHover: (i: number | null, x: number, y: number) => void;
  onSelect: (i: number | null) => void;
  onFolder: (folder: string) => void;
};

export default function Galaxy({ snapshot, graph, highlight, visible, selected, onReady, onHover, onSelect, onFolder }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const engine = useRef<GalaxyEngine | null>(null);
  const handlers = useRef({ onHover, onSelect, onFolder });
  handlers.current = { onHover, onSelect, onFolder };

  useEffect(() => {
    if (!ref.current) return;
    let e: GalaxyEngine;
    try {
      e = new GalaxyEngine(ref.current, snapshot, graph, {
        onHover: (i, x, y) => handlers.current.onHover(i, x, y),
        onSelect: (i) => handlers.current.onSelect(i),
        onFolder: (f) => handlers.current.onFolder(f),
      });
    } catch (err) {
      console.error(err);
      ref.current.innerHTML = '<p class="webgl-error">This browser can\'t draw the 3D map. Try the Size view.</p>';
      return;
    }
    engine.current = e;
    onReady(e);
    return () => {
      onReady(null);
      e.dispose();
      engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, graph]);

  useEffect(() => engine.current?.setHighlight(highlight), [highlight]);
  useEffect(() => engine.current?.setVisible(visible), [visible]);
  useEffect(() => engine.current?.setSelected(selected), [selected]);

  return <div ref={ref} className="galaxy" />;
}
