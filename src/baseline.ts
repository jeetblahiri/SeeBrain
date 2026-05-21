import { BAND_ORDER, type Band } from './signal';

const N_CHANNELS = 4;

export type BaselineStats = {
  mean: Record<Band, number[]>;
  std: Record<Band, number[]>;
  n: number;
};

export class BaselineCollector {
  private sums: Record<Band, number[]>;
  private sumSquares: Record<Band, number[]>;
  private count = 0;
  private targetSamples: number;
  private active = false;

  constructor(targetSeconds: number, hz = 10) {
    this.targetSamples = Math.max(10, Math.round(targetSeconds * hz));
    this.sums = this.zeroMap();
    this.sumSquares = this.zeroMap();
  }

  private zeroMap(): Record<Band, number[]> {
    const m = {} as Record<Band, number[]>;
    for (const b of BAND_ORDER) m[b] = new Array(N_CHANNELS).fill(0);
    return m;
  }

  start() {
    this.sums = this.zeroMap();
    this.sumSquares = this.zeroMap();
    this.count = 0;
    this.active = true;
  }

  isActive() { return this.active; }

  progress(): number {
    return Math.min(1, this.count / this.targetSamples);
  }

  push(perChannelPowers: Record<Band, number>[]): boolean {
    if (!this.active) return false;
    for (const b of BAND_ORDER) {
      for (let c = 0; c < N_CHANNELS; c++) {
        const v = perChannelPowers[c][b];
        this.sums[b][c] += v;
        this.sumSquares[b][c] += v * v;
      }
    }
    this.count++;
    if (this.count >= this.targetSamples) {
      this.active = false;
      return true;
    }
    return false;
  }

  finalize(): BaselineStats {
    const n = Math.max(1, this.count);
    const mean = {} as Record<Band, number[]>;
    const std = {} as Record<Band, number[]>;
    for (const b of BAND_ORDER) {
      mean[b] = new Array(N_CHANNELS).fill(0);
      std[b] = new Array(N_CHANNELS).fill(0);
      for (let c = 0; c < N_CHANNELS; c++) {
        const m = this.sums[b][c] / n;
        const v = Math.max(1e-6, this.sumSquares[b][c] / n - m * m);
        mean[b][c] = m;
        std[b][c] = Math.sqrt(v);
      }
    }
    return { mean, std, n: this.count };
  }
}

export function zScore(stats: BaselineStats, band: Band, channel: number, value: number): number {
  const m = stats.mean[band][channel];
  const s = stats.std[band][channel];
  return (value - m) / Math.max(0.05, s);
}
