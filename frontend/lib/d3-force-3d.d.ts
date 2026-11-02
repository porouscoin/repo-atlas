declare module "d3-force-3d" {
  export interface SimNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
    [key: string]: unknown;
  }
  export interface SimLink<N> {
    source: number | N;
    target: number | N;
    [key: string]: unknown;
  }
  export interface Simulation<N> {
    tick(iterations?: number): this;
    stop(): this;
    alpha(): number;
    alpha(a: number): this;
    alphaMin(a: number): this;
    alphaDecay(a: number): this;
    velocityDecay(a: number): this;
    numDimensions(n: number): this;
    nodes(): N[];
    force(name: string, force: unknown): this;
  }
  export function forceSimulation<N extends SimNode>(nodes?: N[], numDimensions?: number): Simulation<N>;
  export function forceLink<N, L extends SimLink<N>>(links?: L[]): {
    id(fn: (n: N, i: number) => string | number): ReturnType<typeof forceLink<N, L>>;
    distance(d: number | ((l: L) => number)): ReturnType<typeof forceLink<N, L>>;
    strength(s: number | ((l: L) => number)): ReturnType<typeof forceLink<N, L>>;
    iterations(n: number): ReturnType<typeof forceLink<N, L>>;
  };
  export function forceManyBody<N>(): {
    strength(s: number | ((n: N) => number)): ReturnType<typeof forceManyBody<N>>;
    theta(t: number): ReturnType<typeof forceManyBody<N>>;
    distanceMax(d: number): ReturnType<typeof forceManyBody<N>>;
  };
  export function forceY<N>(y?: number): { strength(s: number | ((n: N) => number)): ReturnType<typeof forceY<N>> };
  export function forceCenter(x?: number, y?: number, z?: number): unknown;
}
