import type { WindowDiagnostics } from './signal';

export type ArtifactThresholds = {
  peakAbs: number;
  hfRatio: number;
};

export const DEFAULT_THRESHOLDS: ArtifactThresholds = {
  peakAbs: 200,
  hfRatio: 0.55,
};

export type ArtifactFlag = {
  amplitude: boolean;
  emg: boolean;
  any: boolean;
};

export function checkArtifact(
  diag: WindowDiagnostics,
  thresh: ArtifactThresholds = DEFAULT_THRESHOLDS,
): ArtifactFlag {
  const amp = diag.peakAbs > thresh.peakAbs;
  const emg = diag.hfRatio > thresh.hfRatio;
  return { amplitude: amp, emg, any: amp || emg };
}

export class ArtifactStats {
  private total = 0;
  private bad = 0;
  private recentBad: number[] = [];
  private windowSize = 100;

  push(any: boolean) {
    this.total++;
    if (any) this.bad++;
    this.recentBad.push(any ? 1 : 0);
    if (this.recentBad.length > this.windowSize) this.recentBad.shift();
  }

  reset() {
    this.total = 0;
    this.bad = 0;
    this.recentBad.length = 0;
  }

  rateAll(): number {
    return this.total > 0 ? this.bad / this.total : 0;
  }

  rateRecent(): number {
    if (this.recentBad.length === 0) return 0;
    let s = 0;
    for (const v of this.recentBad) s += v;
    return s / this.recentBad.length;
  }
}
