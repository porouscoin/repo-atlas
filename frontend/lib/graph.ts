import type { Snapshot } from "./api";

export type Graph = {
  index: Map<string, number>;
  imports: number[][]; // i -> files i imports
  importers: number[][]; // i -> files that import i
  folderOf: string[]; // i -> its folder ("" for the root)
  topFolder: string[]; // i -> first path segment, or "" for root files
};

export function buildGraph(s: Snapshot): Graph {
  const n = s.files.length;
  const index = new Map(s.files.map((f, i) => [f.path, i]));
  const imports: number[][] = Array.from({ length: n }, () => []);
  const importers: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of s.edges) {
    imports[a].push(b);
    importers[b].push(a);
  }
  const folderOf = s.files.map((f) =>
    f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "",
  );
  const topFolder = s.files.map((f) =>
    f.path.includes("/") ? f.path.split("/")[0] : "",
  );
  return { index, imports, importers, folderOf, topFolder };
}

export function shortNumber(n: number): string {
  if (n >= 1_000_000)
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000) return Math.round(n / 1000) + "k";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

/** Every file that would feel a change to `files`, directly or through others. */
export function dependents(
  g: Graph,
  files: number[],
): { all: number[]; direct: Set<number> } {
  const inside = new Set(files);
  const direct = new Set<number>();
  for (const f of files)
    for (const i of g.importers[f]) if (!inside.has(i)) direct.add(i);
  const seen = new Set<number>(direct);
  const queue = [...direct];
  while (queue.length) {
    const v = queue.pop()!;
    for (const i of g.importers[v])
      if (!inside.has(i) && !seen.has(i)) {
        seen.add(i);
        queue.push(i);
      }
  }
  return { all: [...seen], direct };
}

/** File pairs (user, used) behind an arrow from one set of files to another. */
export function pairsBetween(
  g: Graph,
  from: number[],
  to: number[],
): [number, number][] {
  const target = new Set(to);
  const out: [number, number][] = [];
  for (const a of from)
    for (const b of g.imports[a]) if (target.has(b)) out.push([a, b]);
  return out;
}
