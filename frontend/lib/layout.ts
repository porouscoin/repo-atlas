/**
 * Lays the boxes of one level out in rows, top to bottom in the direction of
 * use: a box sits above the boxes it imports from, so the foundations end up
 * at the bottom. Boxes with no import links go in a last row of their own.
 */

export type Box = {
  id: string;
  name: string;
  kind: "folder" | "file" | "group";
  target: string;
  files: number[];
  loc: number;
  langs: { lang: string; loc: number }[];
  used_from_outside: number;
  uses_outside: number;
  parts?: string[];
};
export type Link = { from: number; to: number; count: number };

export const CARD_W = 288;
export const CARD_H = 136;
export const GAP_X = 48;
export const GAP_Y = 96;

export type Placed = { x: number; y: number; row: number; loose: boolean };
export type Layout = {
  boxes: Placed[];
  width: number;
  height: number;
  looseRowY: number | null;
};

export function layout(boxes: Box[], links: Link[], perRow = 3): Layout {
  const n = boxes.length;
  const out: number[][] = Array.from({ length: n }, () => []);
  const linked = new Array(n).fill(false);
  for (const l of links) {
    out[l.from].push(l.to);
    linked[l.from] = linked[l.to] = true;
  }

  // Drop the edges that close a cycle, so ranks are well defined.
  const state = new Array(n).fill(0);
  const forward: number[][] = Array.from({ length: n }, () => []);
  const visit = (v: number) => {
    state[v] = 1;
    for (const t of out[v]) {
      if (state[t] === 1) continue; // back edge
      forward[v].push(t);
      if (state[t] === 0) visit(t);
    }
    state[v] = 2;
  };
  const order = [...Array(n).keys()].sort(
    (a, b) => boxes[b].loc - boxes[a].loc,
  );
  for (const v of order) if (state[v] === 0 && linked[v]) visit(v);

  // Longest path from the top: users above the things they use.
  const rank = new Array(n).fill(0);
  let changed = true;
  for (let guard = 0; changed && guard < n + 2; guard++) {
    changed = false;
    for (let v = 0; v < n; v++)
      for (const t of forward[v])
        if (rank[t] < rank[v] + 1) {
          rank[t] = rank[v] + 1;
          changed = true;
        }
  }

  const ranks: number[][] = [];
  for (let v = 0; v < n; v++) if (linked[v]) (ranks[rank[v]] ||= []).push(v);
  const rows = ranks.filter(Boolean);

  // Order each row by the average position of its neighbours above, a few sweeps.
  const pos = new Map<number, number>();
  rows.forEach((r) =>
    r
      .sort((a, b) => boxes[b].loc - boxes[a].loc)
      .forEach((v, k) => pos.set(v, k)),
  );
  const neighbours = (v: number) => [
    ...out[v],
    ...links.filter((l) => l.to === v).map((l) => l.from),
  ];
  for (let sweep = 0; sweep < 4; sweep++) {
    for (const r of rows) {
      const score = new Map(
        r.map((v) => {
          const ns = neighbours(v).filter((u) => pos.has(u));
          return [
            v,
            ns.length
              ? ns.reduce((a, u) => a + pos.get(u)!, 0) / ns.length
              : pos.get(v)!,
          ];
        }),
      );
      r.sort((a, b) => score.get(a)! - score.get(b)!);
      r.forEach((v, k) => pos.set(v, k));
    }
  }

  // Wrap wide rows, then add the unlinked boxes last.
  const lines: { members: number[]; loose: boolean }[] = [];
  for (const r of rows)
    for (let k = 0; k < r.length; k += perRow)
      lines.push({ members: r.slice(k, k + perRow), loose: false });
  const loose = [...Array(n).keys()]
    .filter((v) => !linked[v])
    .sort((a, b) => boxes[b].loc - boxes[a].loc);
  const firstLoose = lines.length;
  for (let k = 0; k < loose.length; k += perRow)
    lines.push({ members: loose.slice(k, k + perRow), loose: true });

  const widest = Math.max(1, ...lines.map((l) => l.members.length));
  const width = widest * CARD_W + (widest - 1) * GAP_X;
  const placed: Placed[] = new Array(n);
  let y = 0;
  let looseRowY: number | null = null;
  lines.forEach((line, row) => {
    if (line.loose && row === firstLoose) {
      if (row > 0) y += 34; // room for the "not linked" label
      looseRowY = row > 0 ? y - 26 : null;
    }
    const w = line.members.length * CARD_W + (line.members.length - 1) * GAP_X;
    line.members.forEach((v, k) => {
      placed[v] = {
        x: (width - w) / 2 + k * (CARD_W + GAP_X),
        y,
        row,
        loose: line.loose,
      };
    });
    y += CARD_H + GAP_Y;
  });
  return {
    boxes: placed,
    width,
    height: Math.max(CARD_H, y - GAP_Y),
    looseRowY,
  };
}

/**
 * Keeps the diagram readable on tightly coupled code: when two parts use
 * each other only the stronger direction is drawn, and only the strongest
 * links are kept (every part keeps its main one). Returns what to draw and
 * how many links were left out.
 */
export function simplify(
  links: Link[],
  n: number,
): { shown: Link[]; hidden: number } {
  const byPair = new Map<string, Link>();
  for (const l of links) {
    const key = l.from < l.to ? `${l.from}-${l.to}` : `${l.to}-${l.from}`;
    const prev = byPair.get(key);
    if (!prev || l.count > prev.count) byPair.set(key, l);
  }
  const pairs = [...byPair.values()].sort((a, b) => b.count - a.count);
  const budget = Math.max(4, n);
  const keep = new Set(pairs.slice(0, budget));
  const strongestOut = new Map<number, Link>();
  for (const l of pairs)
    if (!strongestOut.has(l.from)) strongestOut.set(l.from, l);
  for (const l of strongestOut.values()) keep.add(l);
  const shown = pairs.filter((l) => keep.has(l));
  return { shown, hidden: links.length - shown.length };
}
