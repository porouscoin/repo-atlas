/**
 * The growing file tree: every file that ever existed in the sampled history,
 * laid out as a radial tree for each sampled commit. Positions are worked out
 * once per frame, and playback blends between neighbouring frames, so files
 * sprout from their folder, drift as the tree fills in, and fade when deleted.
 */

export type HistoryData = {
  commits: number;
  frames: {
    sha: string;
    n: number;
    date: string;
    message: string;
    author: string;
    files: number;
    lines: number;
    commits: { sha: string; date: string; message: string; author: string }[];
    people: { name: string; avatar: string; commits: number }[];
  }[];
  paths: string[];
  langs: string[];
  sizes: number[][]; // path -> lines at each frame, 0 when absent
  releases: { tag: string; date: string }[];
};

export type TreeNode = {
  name: string;
  path: string; // folders end with "/"; the root is ""
  parent: number; // -1 for the root
  depth: number;
  children: number[];
  file: number; // index into paths, or -1 for a folder
};

export type Tree = {
  nodes: TreeNode[];
  // per frame: x, y in layout units (radius of the deepest level = 1), NaN when absent
  xs: Float32Array[];
  ys: Float32Array[];
  extent: number[]; // per frame: how far out the tree reaches
};

export function buildTree(h: HistoryData): Tree {
  const nodes: TreeNode[] = [
    { name: "", path: "", parent: -1, depth: 0, children: [], file: -1 },
  ];
  const folder = new Map<string, number>([["", 0]]);
  const ensure = (path: string): number => {
    const hit = folder.get(path);
    if (hit !== undefined) return hit;
    const trimmed = path.slice(0, -1);
    const cut = trimmed.lastIndexOf("/");
    const parent = ensure(cut >= 0 ? trimmed.slice(0, cut + 1) : "");
    const id = nodes.length;
    nodes.push({
      name: trimmed.slice(cut + 1),
      path,
      parent,
      depth: nodes[parent].depth + 1,
      children: [],
      file: -1,
    });
    nodes[parent].children.push(id);
    folder.set(path, id);
    return id;
  };
  h.paths.forEach((p, i) => {
    const cut = p.lastIndexOf("/");
    const parent = ensure(cut >= 0 ? p.slice(0, cut + 1) : "");
    const id = nodes.length;
    nodes.push({
      name: p.slice(cut + 1),
      path: p,
      parent,
      depth: nodes[parent].depth + 1,
      children: [],
      file: i,
    });
    nodes[parent].children.push(id);
  });
  // Folders first, then files, each by name, so the layout is stable from frame to frame.
  for (const n of nodes)
    n.children.sort(
      (a, b) =>
        (nodes[a].file >= 0 ? 1 : 0) - (nodes[b].file >= 0 ? 1 : 0) ||
        nodes[a].name.localeCompare(nodes[b].name),
    );

  const F = h.frames.length;
  const xs: Float32Array[] = [];
  const ys: Float32Array[] = [];
  const extent: number[] = [];
  const weight = new Float32Array(nodes.length);
  // Children come after their parent in `nodes`, so a reverse sweep sums bottom-up.
  for (let f = 0; f < F; f++) {
    weight.fill(0);
    for (let id = nodes.length - 1; id > 0; id--) {
      const n = nodes[id];
      if (n.file >= 0) weight[id] = h.sizes[n.file][f] > 0 ? 1 : 0;
      if (weight[id] > 0) weight[n.parent] += weight[id];
    }
    const x = new Float32Array(nodes.length).fill(NaN);
    const y = new Float32Array(nodes.length).fill(NaN);
    let reach = 0.0001;
    const place = (id: number, a0: number, a1: number) => {
      const n = nodes[id];
      const kids = n.children.filter((c) => weight[c] > 0);
      const crowded = kids.filter((c) => nodes[c].file >= 0).length > 12;
      let nth = 0;
      let a = a0;
      for (const c of kids) {
        const span = ((a1 - a0) * weight[c]) / Math.max(1, weight[id]);
        const mid = a + span / 2;
        const node = nodes[c];
        // Files in a crowded folder are staggered over three rings so they don't sit on one arc.
        const stagger = node.file >= 0 && crowded ? (nth++ % 3) * 0.3 : 0;
        // Square-root rings give the top folders room near the middle and keep deep trees compact.
        const r = Math.sqrt(node.depth + stagger);
        x[c] = Math.cos(mid) * r;
        y[c] = Math.sin(mid) * r;
        reach = Math.max(reach, r);
        if (node.file < 0) place(c, a, a + span);
        a += span;
      }
    };
    x[0] = 0;
    y[0] = 0;
    place(0, -Math.PI / 2, Math.PI * 1.5);
    xs.push(x);
    ys.push(y);
    extent.push(reach);
  }
  return { nodes, xs, ys, extent };
}

/** Where a node is at time t (a fractional frame), and how visible it is. */
export function at(
  tree: Tree,
  id: number,
  t: number,
): { x: number; y: number; a: number; born: boolean } | null {
  const last = tree.xs.length - 1;
  const i = Math.max(0, Math.min(last, Math.floor(t)));
  const j = Math.min(last, i + 1);
  const f = t - i;
  const x0 = tree.xs[i][id];
  const x1 = tree.xs[j][id];
  const here = !Number.isNaN(x0);
  const next = !Number.isNaN(x1);
  if (!here && !next) return null;
  if (here && next)
    return {
      x: x0 + (x1 - x0) * f,
      y: tree.ys[i][id] + (tree.ys[j][id] - tree.ys[i][id]) * f,
      a: 1,
      born: false,
    };
  if (here) return { x: x0, y: tree.ys[i][id], a: 1 - f, born: false }; // fading out
  // sprouting: grow out of the parent's next position
  const p = tree.nodes[id].parent;
  const px = p >= 0 && !Number.isNaN(tree.xs[j][p]) ? tree.xs[j][p] : x1;
  const py =
    p >= 0 && !Number.isNaN(tree.ys[j][p]) ? tree.ys[j][p] : tree.ys[j][id];
  return {
    x: px + (x1 - px) * f,
    y: py + (tree.ys[j][id] - py) * f,
    a: f,
    born: true,
  };
}

export const lerp = (a: number[], t: number) => {
  const i = Math.floor(t);
  const f = t - i;
  return i + 1 < a.length ? a[i] + (a[i + 1] - a[i]) * f : a[a.length - 1];
};
