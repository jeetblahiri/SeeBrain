export type ElectrodeXY = { name: string; x: number; y: number };

export const ELECTRODES: ElectrodeXY[] = [
  { name: 'TP9',  x: -0.86, y: -0.31 },
  { name: 'AF7',  x: -0.31, y:  0.71 },
  { name: 'AF8',  x:  0.31, y:  0.71 },
  { name: 'TP10', x:  0.86, y: -0.31 },
];

export type ColorMode = 'sequential' | 'diverging';

function interpolateStops(
  t: number,
  stops: [number, number, number, number][],
): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, r1, g1, b1] = stops[i];
    const [b, r2, g2, b2] = stops[i + 1];
    if (t >= a && t <= b) {
      const u = (t - a) / (b - a);
      return [r1 + (r2 - r1) * u, g1 + (g2 - g1) * u, b1 + (b2 - b1) * u];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3]];
}

const VIRIDIS: [number, number, number, number][] = [
  [0.0, 68, 1, 84],
  [0.25, 59, 82, 139],
  [0.5, 33, 145, 140],
  [0.75, 94, 201, 98],
  [1.0, 253, 231, 37],
];

const RDBU_R: [number, number, number, number][] = [
  [0.0, 33, 102, 172],
  [0.25, 103, 169, 207],
  [0.5, 240, 240, 240],
  [0.75, 239, 138, 98],
  [1.0, 178, 24, 43],
];

function sampleColor(mode: ColorMode, t: number): [number, number, number] {
  return interpolateStops(t, mode === 'diverging' ? RDBU_R : VIRIDIS);
}

export type CloudGrid = {
  W: number;
  H: number;
  weights: Float32Array;
  alpha: Float32Array;
};

const SIGMA_FRAC = 0.30;
const REACH_INNER_FACTOR = 1.35;
const REACH_OUTER_FACTOR = 1.75;
const ALPHA_SAT = 0.55;

export function buildCloudGrid(W: number, H: number): CloudGrid {
  const cx = W / 2;
  const cy = H / 2;
  const headRadius = Math.min(W, H) * 0.42;
  const sigma = headRadius * SIGMA_FRAC;
  const twoSigma2 = 2 * sigma * sigma;
  const reachInner = sigma * REACH_INNER_FACTOR;
  const reachOuter = sigma * REACH_OUTER_FACTOR;
  const featherSpan = Math.max(1e-3, reachOuter - reachInner);
  const n = ELECTRODES.length;

  const elecPx = ELECTRODES.map(e => ({
    px: cx + e.x * headRadius,
    py: cy - e.y * headRadius,
  }));

  const weights = new Float32Array(W * H * n);
  const alpha = new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > headRadius * headRadius) continue;

      let sumW = 0;
      let minDist2 = Infinity;
      const ws = new Array<number>(n).fill(0);
      for (let k = 0; k < n; k++) {
        const ex = elecPx[k].px;
        const ey = elecPx[k].py;
        const d2 = (x - ex) * (x - ex) + (y - ey) * (y - ey);
        if (d2 < minDist2) minDist2 = d2;
        const w = Math.exp(-d2 / twoSigma2);
        ws[k] = w;
        sumW += w;
      }
      const minDist = Math.sqrt(minDist2);
      if (minDist > reachOuter || sumW <= 1e-6) continue;

      const gate = minDist <= reachInner
        ? 1
        : 1 - (minDist - reachInner) / featherSpan;

      for (let k = 0; k < n; k++) {
        weights[idx * n + k] = ws[k] / sumW;
      }
      alpha[idx] = Math.min(1, sumW / ALPHA_SAT) * gate;
    }
  }
  return { W, H, weights, alpha };
}

export class TopoRenderer {
  private ctx: CanvasRenderingContext2D;
  private image: ImageData;
  private grid: CloudGrid;

  constructor(canvas: HTMLCanvasElement, grid?: CloudGrid) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('No 2D context');
    this.ctx = ctx;
    this.grid = grid ?? buildCloudGrid(canvas.width, canvas.height);
    this.image = ctx.createImageData(canvas.width, canvas.height);
  }

  render(values: Float32Array, vmin: number, vmax: number, mode: ColorMode = 'sequential') {
    const { W, H, weights, alpha } = this.grid;
    const data = this.image.data;
    const span = Math.max(1e-9, vmax - vmin);
    const n = ELECTRODES.length;
    const total = W * H;

    for (let idx = 0; idx < total; idx++) {
      const di = idx * 4;
      const a = alpha[idx];
      if (a <= 0) {
        data[di] = 0; data[di + 1] = 0; data[di + 2] = 0; data[di + 3] = 0;
        continue;
      }
      let v = 0;
      const base = idx * n;
      for (let k = 0; k < n; k++) v += weights[base + k] * values[k];
      const t = (v - vmin) / span;
      const [r, g, b] = sampleColor(mode, t);
      data[di] = r;
      data[di + 1] = g;
      data[di + 2] = b;
      data[di + 3] = Math.round(a * 255);
    }
    this.ctx.putImageData(this.image, 0, 0);
  }
}

export type OverlayOpts = { labels?: boolean; labelFontSize?: number; stroke?: number };

export function drawHeadOverlay(svg: SVGSVGElement, opts: OverlayOpts = {}) {
  const labels = opts.labels ?? true;
  const fontSize = opts.labelFontSize ?? 11;
  const stroke = opts.stroke ?? 1.5;

  const W = Number(svg.getAttribute('width')) || 200;
  const H = Number(svg.getAttribute('height')) || 200;
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(W, H) * 0.42;
  const ns = 'http://www.w3.org/2000/svg';
  svg.innerHTML = '';

  const head = document.createElementNS(ns, 'circle');
  head.setAttribute('cx', String(cx));
  head.setAttribute('cy', String(cy));
  head.setAttribute('r', String(radius));
  head.setAttribute('fill', 'none');
  head.setAttribute('stroke', '#cdd3df');
  head.setAttribute('stroke-width', String(stroke));
  svg.appendChild(head);

  const nose = document.createElementNS(ns, 'polygon');
  const noseTip = cy - radius - Math.max(8, radius * 0.12);
  const noseHalf = Math.max(5, radius * 0.07);
  nose.setAttribute(
    'points',
    `${cx - noseHalf},${cy - radius + 2} ${cx + noseHalf},${cy - radius + 2} ${cx},${noseTip}`
  );
  nose.setAttribute('fill', 'none');
  nose.setAttribute('stroke', '#cdd3df');
  nose.setAttribute('stroke-width', String(stroke));
  svg.appendChild(nose);

  const earH = Math.max(14, radius * 0.18);
  const earW = Math.max(6, radius * 0.09);
  const ear = (side: 1 | -1) => {
    const e = document.createElementNS(ns, 'path');
    const ex = cx + side * radius;
    e.setAttribute('d', `M ${ex} ${cy - earH / 2} q ${side * earW} ${earH / 2} 0 ${earH}`);
    e.setAttribute('fill', 'none');
    e.setAttribute('stroke', '#cdd3df');
    e.setAttribute('stroke-width', String(stroke));
    svg.appendChild(e);
  };
  ear(1); ear(-1);

  if (labels) {
    for (const el of ELECTRODES) {
      const x = cx + el.x * radius;
      const y = cy - el.y * radius;
      const labelOffset = Math.max(18, radius * 0.22);
      const t = document.createElementNS(ns, 'text');
      const labelX = x + el.x * labelOffset;
      const labelY = y - el.y * labelOffset + fontSize / 3;
      t.setAttribute('x', String(labelX));
      t.setAttribute('y', String(labelY));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('fill', '#e6e8ee');
      t.setAttribute('font-size', String(fontSize));
      t.setAttribute('font-family', 'ui-monospace, monospace');
      t.textContent = el.name;
      svg.appendChild(t);
    }
  }
}

export function drawLegend(canvas: HTMLCanvasElement, mode: ColorMode = 'sequential') {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  const img = ctx.createImageData(W, H);
  for (let x = 0; x < W; x++) {
    const t = x / (W - 1);
    const [r, g, b] = sampleColor(mode, t);
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
