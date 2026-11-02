/**
 * The galaxy view, written straight against three.js: every file is a star,
 * folders pull their files into clusters, and imports are faint threads
 * between stars. React drives it through the methods on GalaxyEngine.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { forceLink, forceManyBody, forceSimulation, forceY, type SimNode } from "d3-force-3d";

import type { Snapshot } from "./api";
import { IMPORTERS_COLOR, IMPORTS_COLOR, langColor } from "./colors";
import type { Graph } from "./graph";

type Node = SimNode & { folder?: string; depth?: number; weight?: number };

export type GalaxyCallbacks = {
  onHover: (i: number | null, x: number, y: number) => void;
  onSelect: (i: number | null) => void;
  onFolder?: (folder: string) => void;
};

const STAR_VERT = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute float flash;
  attribute vec3 color;
  uniform float scale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float s = size * (1.0 + flash * 1.4);
    gl_PointSize = s > 0.0 ? clamp(s * scale / -mv.z, 3.2, 220.0) : 0.0;
    gl_Position = projectionMatrix * mv;
    vColor = mix(color, vec3(1.0), flash * 0.7);
    vAlpha = alpha;
  }
`;

const STAR_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(0.42, 0.18, d);
    float halo = pow(1.0 - d, 2.4) * 0.55;
    float a = max(core, halo);
    vec3 col = mix(vColor, vec3(1.0), smoothstep(0.24, 0.0, d) * 0.55);
    gl_FragColor = vec4(col, a * vAlpha);
  }
`;

const NEBULA_VERT = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  uniform float scale;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(size * scale / -mv.z, 0.0, 1400.0);
    gl_Position = projectionMatrix * mv;
    vColor = color;
  }
`;

const NEBULA_FRAG = /* glsl */ `
  uniform float strength;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = exp(-d * d * 4.5) * 0.07 * strength;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class GalaxyEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private stars: THREE.Points;
  private starGeo = new THREE.BufferGeometry();
  private starMat: THREE.ShaderMaterial;
  private edges: THREE.LineSegments;
  private edgeGeo = new THREE.BufferGeometry();
  private edgeMat: THREE.LineBasicMaterial;
  private hiEdges: THREE.LineSegments;
  private hiGeo = new THREE.BufferGeometry();
  private ring: THREE.Mesh;
  private labels: { el: HTMLDivElement; node: Node; depth: number; members: number[]; at: THREE.Vector3 }[] = [];
  private nebulae: { hub: number; members: number[]; color: THREE.Color }[] = [];
  private nebulaGeo = new THREE.BufferGeometry();
  private nebulaMat!: THREE.ShaderMaterial;
  private labelLayer: HTMLDivElement;

  private nodes: Node[];
  private n: number;
  private sim;
  private baseSize: Float32Array;
  private positions: Float32Array;
  private alphas: Float32Array;
  private sizes: Float32Array;
  private flashes: Float32Array;
  private baseEdgeColors: Float32Array;

  private highlight: Set<number> | null = null;
  private visible: Uint8Array | null = null;
  private selected: number | null = null;
  private hovered: number | null = null;
  private flying: { t0: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; c0: THREE.Vector3; c1: THREE.Vector3 } | null =
    null;
  private userMoved = false;
  private overviewDist = 500;
  private autoFit = true;
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private down: { x: number; y: number } | null = null;
  private projected = new Float32Array(0);
  private disposed = false;

  constructor(
    private container: HTMLElement,
    private snapshot: Snapshot,
    private graph: Graph,
    private cb: GalaxyCallbacks,
  ) {
    const files = snapshot.files;
    this.n = files.length;
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x04060d, 1);
    this.scene.background = GalaxyEngine.backdrop();
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.5, 30000);
    this.camera.position.set(0, 160, 520);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 9000;
    this.controls.addEventListener("start", () => {
      this.userMoved = true;
      this.autoFit = false;
      this.flying = null;
      this.controls.autoRotate = false;
    });

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.7, 0.45, 0.35);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.addBackdrop();

    // ---- layout: files plus one hidden hub node per folder
    const folderIndex = new Map<string, number>();
    const folderWeight = new Map<string, number>();
    for (const f of graph.folderOf) {
      let p = f;
      for (;;) {
        folderWeight.set(p, (folderWeight.get(p) || 0) + 1);
        if (!p) break;
        p = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
      }
    }
    const tops = [...new Set(graph.topFolder.filter(Boolean))].sort(
      (a, b) => (folderWeight.get(b) || 0) - (folderWeight.get(a) || 0),
    );
    const topAngle = new Map(tops.map((t, k) => [t, (k / Math.max(1, tops.length)) * Math.PI * 2]));
    const spread = 30 + Math.sqrt(this.n) * 4;
    const seed = (path: string, top: string, r: number): Node => {
      const a = (topAngle.get(top) ?? 0) + (hash(path) - 0.5) * 0.6;
      const rr = top ? spread * (0.6 + hash(path + "r") * 0.5) : r * hash(path + "r");
      return {
        x: Math.cos(a) * rr + (hash(path + "x") - 0.5) * r,
        y: (hash(path + "y") - 0.5) * r * 0.5,
        z: Math.sin(a) * rr + (hash(path + "z") - 0.5) * r,
      };
    };

    this.nodes = files.map((f, i) => seed(f.path, graph.topFolder[i], 20));
    for (const [folder, weight] of [...folderWeight.entries()].sort((a, b) => a[0].length - b[0].length)) {
      folderIndex.set(folder, this.nodes.length);
      this.nodes.push({
        ...seed(folder, folder.split("/")[0], 10),
        folder,
        depth: folder ? folder.split("/").length : 0,
        weight,
      });
    }
    const root = folderIndex.get("")!;
    this.nodes[root].fx = 0;
    this.nodes[root].fy = 0;
    this.nodes[root].fz = 0;

    type L = { source: number; target: number; kind: number; d: number };
    const links: L[] = [];
    const siblings = new Map<string, number>();
    for (const f of graph.folderOf) siblings.set(f, (siblings.get(f) || 0) + 1);
    files.forEach((_, i) => {
      const folder = graph.folderOf[i];
      links.push({ source: i, target: folderIndex.get(folder)!, kind: 0, d: 4 + Math.sqrt(siblings.get(folder) || 1) * 2.2 });
    });
    for (const [folder, idx] of folderIndex) {
      if (!folder) continue;
      const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
      const wgt = folderWeight.get(folder) || 1;
      links.push({ source: idx, target: folderIndex.get(parent)!, kind: 1, d: 14 + Math.sqrt(wgt) * 4.5 });
    }
    for (const [a, b] of snapshot.edges) {
      if (graph.folderOf[a] !== graph.folderOf[b]) links.push({ source: a, target: b, kind: 2, d: 30 });
    }

    this.sim = forceSimulation<Node>(this.nodes, 3)
      .force(
        "link",
        forceLink<Node, L>(links)
          .distance((l) => l.d)
          .strength((l) => (l.kind === 2 ? (snapshot.edges.length > 1500 ? 0.003 : 0.01) : l.kind === 1 ? 0.7 : 0.9)),
      )
      .force(
        "charge",
        forceManyBody<Node>()
          .strength((d) => (d.folder !== undefined ? -25 - Math.sqrt(d.weight || 1) * 6 : -12))
          .theta(0.95)
          .distanceMax(400),
      )
      .force("flat", forceY<Node>(0).strength(0.035))
      .velocityDecay(0.38)
      .alphaDecay(0.018)
      .stop();
    this.sim.tick(40);

    // ---- stars
    this.positions = new Float32Array(this.n * 3);
    this.baseSize = new Float32Array(this.n);
    this.sizes = new Float32Array(this.n);
    this.alphas = new Float32Array(this.n).fill(1);
    this.flashes = new Float32Array(this.n);
    const colors = new Float32Array(this.n * 3);
    const c = new THREE.Color();
    files.forEach((f, i) => {
      c.set(langColor(f.lang));
      colors.set([c.r, c.g, c.b], i * 3);
      this.baseSize[i] = 3 + Math.cbrt(Math.max(1, f.loc)) * 0.95;
    });
    this.sizes.set(this.baseSize);
    this.starGeo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.starGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.starGeo.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1));
    this.starGeo.setAttribute("alpha", new THREE.BufferAttribute(this.alphas, 1));
    this.starGeo.setAttribute("flash", new THREE.BufferAttribute(this.flashes, 1));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { scale: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.stars = new THREE.Points(this.starGeo, this.starMat);
    this.stars.frustumCulled = false;

    // ---- import threads
    const m = snapshot.edges.length;
    this.edgeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(m * 6), 3));
    this.baseEdgeColors = new Float32Array(m * 6);
    snapshot.edges.forEach(([a, b], k) => {
      this.baseEdgeColors.set(colors.subarray(a * 3, a * 3 + 3), k * 6);
      this.baseEdgeColors.set(colors.subarray(b * 3, b * 3 + 3), k * 6 + 3);
    });
    this.edgeGeo.setAttribute("color", new THREE.BufferAttribute(this.baseEdgeColors.slice(), 3));
    this.edgeMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: Math.min(0.24, Math.max(0.03, 0.24 / Math.sqrt(Math.max(1, m / 250)))),
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    this.edges = new THREE.LineSegments(this.edgeGeo, this.edgeMat);
    this.edges.frustumCulled = false;

    this.hiGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    this.hiGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(0), 3));
    this.hiEdges = new THREE.LineSegments(
      this.hiGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.hiEdges.frustumCulled = false;

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1, 72),
      new THREE.MeshBasicMaterial({ color: 0x9fe4ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.ring.visible = false;

    this.scene.add(this.edges, this.hiEdges, this.stars, this.ring);

    // ---- folder labels
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "galaxy-labels";
    container.appendChild(this.labelLayer);
    // Label the folders that explain the repo at a glance. A folder holding
    // most of the repo (like src/ or django/) is replaced by its children.
    const kids = new Map<string, string[]>();
    for (const f of folderIndex.keys()) {
      if (!f) continue;
      const parent = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
      kids.set(parent, [...(kids.get(parent) || []), f]);
    }
    const weightOf = (f: string) => folderWeight.get(f) || 0;
    let primary = (kids.get("") || []).filter((f) => weightOf(f) >= 2);
    for (let round = 0; round < 3; round++) {
      primary = primary.flatMap((f) => {
        const ch = (kids.get(f) || []).filter((c) => weightOf(c) >= 2);
        const big = weightOf(f) > this.n * 0.4 && ch.reduce((a, c) => a + weightOf(c), 0) > weightOf(f) * 0.5;
        return big ? ch : [f];
      });
    }
    primary.sort((a, b) => weightOf(b) - weightOf(a));
    const secondary = primary.flatMap((f) => (kids.get(f) || []).filter((c) => weightOf(c) >= 6));
    const chosen: [string, number][] = [...primary.slice(0, 16).map((f) => [f, 1] as [string, number]), ...secondary.sort((a, b) => weightOf(b) - weightOf(a)).slice(0, 80).map((f) => [f, 2] as [string, number])];
    for (const [folder, tier] of chosen) {
      const el = document.createElement("div");
      el.className = tier === 1 ? "glabel top" : "glabel";
      el.textContent = tier === 1 && !folder.includes("/") ? folder : folder.split("/").pop()!;
      el.title = folder + "/";
      el.addEventListener("click", () => cb.onFolder?.(folder));
      this.labelLayer.appendChild(el);
      const prefix = folder + "/";
      const members = files.flatMap((f, i) => (f.path.startsWith(prefix) ? [i] : []));
      this.labels.push({ el, node: this.nodes[folderIndex.get(folder)!], depth: tier, members, at: new THREE.Vector3() });
    }

    // ---- nebulae: a soft glow around each folder's cluster
    const direct = new Map<string, number[]>();
    graph.folderOf.forEach((f, i) => direct.set(f, [...(direct.get(f) || []), i]));
    for (const [folder, members] of direct) {
      if (members.length < 4) continue;
      const tally = new Map<string, number>();
      for (const i of members) tally.set(files[i].lang, (tally.get(files[i].lang) || 0) + files[i].loc + 1);
      const lang = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
      this.nebulae.push({ hub: folderIndex.get(folder)!, members, color: new THREE.Color(langColor(lang)) });
    }
    const nb = this.nebulae.length;
    this.nebulaGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nb * 3), 3));
    this.nebulaGeo.setAttribute("size", new THREE.BufferAttribute(new Float32Array(nb), 1));
    const nbColors = new Float32Array(nb * 3);
    this.nebulae.forEach((neb, k) => nbColors.set([neb.color.r, neb.color.g, neb.color.b], k * 3));
    this.nebulaGeo.setAttribute("color", new THREE.BufferAttribute(nbColors, 3));
    this.nebulaMat = new THREE.ShaderMaterial({
      vertexShader: NEBULA_VERT,
      fragmentShader: NEBULA_FRAG,
      uniforms: { scale: { value: 1 }, strength: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const nebula = new THREE.Points(this.nebulaGeo, this.nebulaMat);
    nebula.frustumCulled = false;
    nebula.renderOrder = -1;
    this.scene.add(nebula);

    this.copyPositions();
    this.updateScale();

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.fit(this.allIndices(), 0);
    this.loop();
  }

  // ------------------------------------------------------------ public API

  /** Dim every star except these. null shows everything at full brightness. */
  setHighlight(indices: Iterable<number> | null) {
    this.highlight = indices ? new Set(indices) : null;
    this.applyLook();
  }

  /** For the time-lapse: 1 = the file exists at this point in history. null = show all. */
  setVisible(visible: Uint8Array | null) {
    this.visible = visible;
    this.applyLook();
  }

  setSelected(i: number | null) {
    this.selected = i;
    this.ring.visible = i !== null;
    this.buildHiEdges();
    this.applyLook();
  }

  /** Make stars flare briefly, like a commit touching files. */
  flash(indices: number[]) {
    for (const i of indices) this.flashes[i] = 1;
  }

  /** Fly the camera to frame these files. */
  focus(indices: number[], ms = 1300) {
    if (!indices.length) return;
    this.autoFit = false;
    this.fit(indices, ms);
  }

  overview(ms = 1300) {
    this.autoFit = false;
    this.fit(this.allIndices(), ms);
  }

  screenPosition(i: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]).project(this.camera);
    if (v.z > 1) return null;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.starGeo.dispose();
    this.edgeGeo.dispose();
    this.hiGeo.dispose();
    this.nebulaGeo.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }

  // ------------------------------------------------------------ internals

  /** The deep-space gradient behind the stars, painted once on a canvas. */
  private static backdrop(): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 640;
    const g = c.getContext("2d")!;
    g.fillStyle = "#04060d";
    g.fillRect(0, 0, c.width, c.height);
    const glow = (x: number, y: number, r: number, color: string) => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, color);
      grad.addColorStop(1, "rgba(4,6,13,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, c.width, c.height);
    };
    glow(720, 150, 620, "rgba(70,60,160,0.20)");
    glow(160, 560, 520, "rgba(20,120,170,0.13)");
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private allIndices() {
    return Array.from({ length: this.n }, (_, i) => i);
  }

  private addBackdrop() {
    const count = 1800;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const r = 6000 + Math.random() * 6000;
      const s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(t), r * u, r * s * Math.sin(t)], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x8fa3c8, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.55 });
    const dust = new THREE.Points(geo, mat);
    dust.frustumCulled = false;
    this.scene.add(dust);
  }

  private copyPositions() {
    for (let i = 0; i < this.n; i++) {
      const nd = this.nodes[i];
      this.positions[i * 3] = nd.x || 0;
      this.positions[i * 3 + 1] = nd.y || 0;
      this.positions[i * 3 + 2] = nd.z || 0;
    }
    (this.starGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    const ep = this.edgeGeo.attributes.position.array as Float32Array;
    this.snapshot.edges.forEach(([a, b], k) => {
      ep[k * 6] = this.positions[a * 3];
      ep[k * 6 + 1] = this.positions[a * 3 + 1];
      ep[k * 6 + 2] = this.positions[a * 3 + 2];
      ep[k * 6 + 3] = this.positions[b * 3];
      ep[k * 6 + 4] = this.positions[b * 3 + 1];
      ep[k * 6 + 5] = this.positions[b * 3 + 2];
    });
    (this.edgeGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    if (this.selected !== null) this.buildHiEdges();
    for (const l of this.labels) {
      l.at.set(0, 0, 0);
      for (const i of l.members) {
        l.at.x += this.positions[i * 3];
        l.at.y += this.positions[i * 3 + 1];
        l.at.z += this.positions[i * 3 + 2];
      }
      l.at.divideScalar(Math.max(1, l.members.length));
    }
    const np = this.nebulaGeo.attributes.position?.array as Float32Array | undefined;
    const ns = this.nebulaGeo.attributes.size?.array as Float32Array | undefined;
    if (np && ns) {
      this.nebulae.forEach((neb, k) => {
        const h = this.nodes[neb.hub];
        np[k * 3] = h.x || 0;
        np[k * 3 + 1] = h.y || 0;
        np[k * 3 + 2] = h.z || 0;
        let r = 0;
        for (const i of neb.members) {
          const dx = this.positions[i * 3] - np[k * 3];
          const dy = this.positions[i * 3 + 1] - np[k * 3 + 1];
          const dz = this.positions[i * 3 + 2] - np[k * 3 + 2];
          r += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        ns[k] = (r / neb.members.length) * 3.2 + 10;
      });
      (this.nebulaGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.nebulaGeo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private applyLook() {
    const hl = this.highlight;
    const vis = this.visible;
    for (let i = 0; i < this.n; i++) {
      const hidden = vis !== null && vis[i] === 0;
      const lit = !hl || hl.has(i) || i === this.selected;
      this.alphas[i] = hidden ? 0 : lit ? 1 : 0.1;
      this.sizes[i] = hidden ? 0 : this.baseSize[i] * (hl && hl.has(i) ? 1.35 : 1);
    }
    (this.starGeo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
    (this.starGeo.attributes.size as THREE.BufferAttribute).needsUpdate = true;

    this.nebulaMat.uniforms.strength.value = hl || vis ? 0.35 : 1;
    const col = this.edgeGeo.attributes.color.array as Float32Array;
    const dim = hl || this.selected !== null ? 0.25 : 1;
    this.snapshot.edges.forEach(([a, b], k) => {
      const off = vis !== null && (vis[a] === 0 || vis[b] === 0);
      const f = off ? 0 : dim;
      for (let j = 0; j < 6; j++) col[k * 6 + j] = this.baseEdgeColors[k * 6 + j] * f;
    });
    (this.edgeGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  private buildHiEdges() {
    const i = this.selected;
    if (i === null) {
      this.hiGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
      this.hiGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(0), 3));
      return;
    }
    const outs = this.graph.imports[i];
    const ins = this.graph.importers[i];
    const pos = new Float32Array((outs.length + ins.length) * 6);
    const col = new Float32Array((outs.length + ins.length) * 6);
    const a = new THREE.Color(IMPORTS_COLOR);
    const b = new THREE.Color(IMPORTERS_COLOR);
    let k = 0;
    const put = (from: number, to: number, c: THREE.Color) => {
      pos.set(this.positions.subarray(from * 3, from * 3 + 3), k * 6);
      pos.set(this.positions.subarray(to * 3, to * 3 + 3), k * 6 + 3);
      col.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6);
      k++;
    };
    outs.forEach((t) => put(i, t, a));
    ins.forEach((s) => put(s, i, b));
    this.hiGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.hiGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }

  private bounds(indices: number[]) {
    const c = new THREE.Vector3();
    let count = 0;
    for (const i of indices) {
      if (this.visible && this.visible[i] === 0) continue;
      c.x += this.positions[i * 3];
      c.y += this.positions[i * 3 + 1];
      c.z += this.positions[i * 3 + 2];
      count++;
    }
    if (!count) return null;
    c.divideScalar(count);
    const dists: number[] = [];
    for (const i of indices) {
      if (this.visible && this.visible[i] === 0) continue;
      const dx = this.positions[i * 3] - c.x;
      const dy = this.positions[i * 3 + 1] - c.y;
      const dz = this.positions[i * 3 + 2] - c.z;
      dists.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    dists.sort((x, y) => x - y);
    const r = dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.92))];
    return { c, r: Math.max(r, 28) };
  }

  private fit(indices: number[], ms: number) {
    const b = this.bounds(indices);
    if (!b) return;
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = Math.min(1, this.camera.aspect);
    const dist = (b.r * 1.1) / Math.tan(fov / 2) / aspect + 10;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.lengthSq() < 0.5) dir.set(0, 0.35, 1).normalize();
    if (indices.length === this.n) dir.set(dir.x, Math.max(dir.y, 0.55), dir.z).normalize();
    if (indices.length === this.n) this.overviewDist = dist;
    const p1 = b.c.clone().add(dir.multiplyScalar(dist));
    if (ms <= 0) {
      this.camera.position.copy(p1);
      this.controls.target.copy(b.c);
      return;
    }
    this.flying = { t0: performance.now(), dur: ms, p0: this.camera.position.clone(), p1, c0: this.controls.target.clone(), c1: b.c };
  }

  private updateScale() {
    const h = this.renderer.domElement.clientHeight || 600;
    this.starMat.uniforms.scale.value = (h * this.renderer.getPixelRatio()) / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
    if (this.nebulaMat) this.nebulaMat.uniforms.scale.value = this.starMat.uniforms.scale.value;
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.updateScale();
  }

  private pick(x: number, y: number): number | null {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const v = new THREE.Vector3();
    const scale = this.starMat.uniforms.scale.value / this.renderer.getPixelRatio();
    let best: number | null = null;
    let bestD = Infinity;
    const view = this.camera.matrixWorldInverse;
    for (let i = 0; i < this.n; i++) {
      if (this.alphas[i] === 0) continue;
      v.set(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]);
      const depth = -v.clone().applyMatrix4(view).z;
      if (depth <= 0) continue;
      v.project(this.camera);
      const sx = ((v.x + 1) / 2) * w;
      const sy = ((1 - v.y) / 2) * h;
      const d = Math.hypot(sx - x, sy - y);
      const radius = Math.max(7, (this.sizes[i] * scale) / depth / 3);
      if (d < radius && d - radius * 0.2 < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private onPointerMove = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (this.down && Math.hypot(x - this.down.x, y - this.down.y) > 4) {
      if (this.hovered !== null) {
        this.hovered = null;
        this.cb.onHover(null, 0, 0);
      }
      return;
    }
    const i = this.pick(x, y);
    this.renderer.domElement.style.cursor = i === null ? "grab" : "pointer";
    if (i !== this.hovered) this.hovered = i;
    this.cb.onHover(i, x, y);
  };

  private onPointerDown = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.down = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  private onPointerUp = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const start = this.down;
    this.down = null;
    if (!start || Math.hypot(x - start.x, y - start.y) > 4) return;
    this.cb.onSelect(this.pick(x, y));
  };

  private onPointerLeave = () => {
    this.down = null;
    this.hovered = null;
    this.cb.onHover(null, 0, 0);
  };

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);

    if (this.sim.alpha() > 0.004) {
      const t0 = performance.now();
      let ticks = 0;
      while (ticks < 6 && performance.now() - t0 < 9) {
        this.sim.tick();
        ticks++;
      }
      this.copyPositions();
      if (this.autoFit && !this.userMoved && !this.flying) this.fit(this.allIndices(), 0);
    }

    if (this.flying) {
      const t = Math.min(1, (performance.now() - this.flying.t0) / this.flying.dur);
      const k = ease(t);
      this.camera.position.lerpVectors(this.flying.p0, this.flying.p1, k);
      this.controls.target.lerpVectors(this.flying.c0, this.flying.c1, k);
      if (t >= 1) this.flying = null;
    }

    let flashing = false;
    for (let i = 0; i < this.n; i++) {
      if (this.flashes[i] > 0.01) {
        this.flashes[i] *= 0.94;
        flashing = true;
      } else if (this.flashes[i] !== 0) {
        this.flashes[i] = 0;
        flashing = true;
      }
    }
    if (flashing) (this.starGeo.attributes.flash as THREE.BufferAttribute).needsUpdate = true;

    if (this.selected !== null) {
      const i = this.selected;
      this.ring.position.set(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]);
      this.ring.quaternion.copy(this.camera.quaternion);
      const s = this.baseSize[i] * 0.42 + 1.2;
      this.ring.scale.set(s, s, s);
    }

    this.controls.update();
    this.updateLabels();
    this.composer.render();
  };

  private updateLabels() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const v = new THREE.Vector3();
    const camDist = this.camera.position.distanceTo(this.controls.target);
    const zoom = this.overviewDist / Math.max(1, camDist); // 1 at the overview, bigger when closer
    const placed: [number, number, number, number][] = [];
    for (const l of this.labels) {
      v.copy(l.at).project(this.camera);
      const x = ((v.x + 1) / 2) * w;
      const y = ((1 - v.y) / 2) * h;
      let opacity = l.depth === 1 ? 1 : Math.min(1, Math.max(0, (zoom - 1.6) * 1.5));
      const bw = (l.el.textContent || "").length * (l.depth === 1 ? 7.6 : 6.6) + 10;
      const box: [number, number, number, number] = [x - bw / 2, y - 9, x + bw / 2, y + 9];
      const overlaps = placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      if (v.z > 1 || overlaps || x < -50 || x > w + 50 || y < -20 || y > h + 20) opacity = 0;
      if (opacity <= 0.02) {
        l.el.style.opacity = "0";
        l.el.style.pointerEvents = "none";
        continue;
      }
      placed.push(box);
      l.el.style.opacity = String(opacity);
      l.el.style.pointerEvents = "auto";
      l.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }

}
