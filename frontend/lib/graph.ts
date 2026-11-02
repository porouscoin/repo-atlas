import type { Commit, Snapshot } from "./api";

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
  const folderOf = s.files.map((f) => (f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""));
  const topFolder = s.files.map((f) => (f.path.includes("/") ? f.path.split("/")[0] : ""));
  return { index, imports, importers, folderOf, topFolder };
}

/** Files under a target: a file path, a folder path ending in "/", or "" for everything. */
export function filesFor(target: string, s: Snapshot, g: Graph): number[] {
  if (!target) return s.files.map((_, i) => i);
  if (g.index.has(target)) return [g.index.get(target)!];
  const prefix = target.endsWith("/") ? target : target + "/";
  return s.files.flatMap((f, i) => (f.path.startsWith(prefix) ? [i] : []));
}

// ---------------------------------------------------------------- time-lapse

export type Frame = {
  visible: Uint8Array; // 1 if the file exists after this commit
  touched: number[]; // files the commit added or changed
};

/**
 * Replays the commits over the files on the map. The files a commit added
 * are hidden before it, so the repo grows as the time-lapse plays. Files that
 * no longer exist today have nowhere to be drawn and are left out.
 */
export function replay(s: Snapshot, g: Graph, commits: Commit[]): { start: Uint8Array; frames: Frame[] } {
  const n = s.files.length;
  const visible = new Uint8Array(n).fill(1);
  const at = (p: string | null) => (p == null ? undefined : g.index.get(p));
  for (let k = commits.length - 1; k >= 0; k--) {
    for (const f of commits[k].files) {
      const i = at(f.path);
      if (f.status === "added" || f.status === "renamed" || f.status === "copied") {
        if (i !== undefined) visible[i] = 0;
        const prev = at(f.prev);
        if (f.status === "renamed" && prev !== undefined) visible[prev] = 1;
      } else if (f.status === "removed" && i !== undefined) {
        visible[i] = 1;
      }
    }
  }
  const start = visible.slice();
  const frames: Frame[] = [];
  for (const c of commits) {
    const touched: number[] = [];
    for (const f of c.files) {
      const i = at(f.path);
      if (f.status === "removed") {
        if (i !== undefined) visible[i] = 0;
        continue;
      }
      if (f.status === "renamed") {
        const prev = at(f.prev);
        if (prev !== undefined) visible[prev] = 0;
      }
      if (i !== undefined) {
        visible[i] = 1;
        touched.push(i);
      }
    }
    frames.push({ visible: visible.slice(), touched });
  }
  return { start, frames };
}

export function shortNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000) return Math.round(n / 1000) + "k";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}
