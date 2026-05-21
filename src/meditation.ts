import { BAND_ORDER, type Band } from './signal';
import { type BaselineStats, zScore } from './baseline';
import type { MeditationState, DerivedIndices } from './analysis';
import { MEDITATION_STATES } from './analysis';

export const CH_TP9 = 0;
export const CH_AF7 = 1;
export const CH_AF8 = 2;
export const CH_TP10 = 3;

export type ZScoreMap = Record<Band, number[]>;

export function computeZScores(
  perChannelPowers: Record<Band, number>[],
  stats: BaselineStats,
): ZScoreMap {
  const out = {} as ZScoreMap;
  for (const b of BAND_ORDER) {
    out[b] = new Array(perChannelPowers.length);
    for (let c = 0; c < perChannelPowers.length; c++) {
      out[b][c] = zScore(stats, b, c, perChannelPowers[c][b]);
    }
  }
  return out;
}

export type MeditationComponents = {
  alphaTemporal: number;
  thetaFrontal: number;
  betaFrontal: number;
};

export function meditationComponents(z: ZScoreMap): MeditationComponents {
  return {
    alphaTemporal: 0.5 * (z.alpha[CH_TP9] + z.alpha[CH_TP10]),
    thetaFrontal: 0.5 * (z.theta[CH_AF7] + z.theta[CH_AF8]),
    betaFrontal:  0.5 * (z.beta[CH_AF7]  + z.beta[CH_AF8]),
  };
}

export function meditationScore(c: MeditationComponents): number {
  return 0.4 * c.alphaTemporal + 0.3 * c.thetaFrontal - 0.3 * c.betaFrontal;
}

export type RecordingSample = {
  t: number;
  score: number;
  components: MeditationComponents;
  indices: DerivedIndices;
  state: MeditationState;
};

export class Recorder {
  private samples: RecordingSample[] = [];
  private t0 = 0;
  private active = false;

  start() {
    this.samples = [];
    this.t0 = performance.now();
    this.active = true;
  }

  push(s: Omit<RecordingSample, 't'>) {
    if (!this.active) return;
    this.samples.push({
      t: (performance.now() - this.t0) / 1000,
      ...s,
    });
  }

  stop(): RecordingSummary {
    this.active = false;
    return summarize(this.samples);
  }

  isActive() { return this.active; }
  elapsed(): number { return this.active ? (performance.now() - this.t0) / 1000 : 0; }
  get data(): RecordingSample[] { return this.samples; }
}

export type RecordingSummary = {
  durationSec: number;
  meanScore: number;
  peakScore: number;
  fractionMeditative: number;
  meanComponents: MeditationComponents;
  meanIndices: DerivedIndices;
  stateTime: Record<MeditationState, number>;
  samples: RecordingSample[];
};

const MEDITATIVE_THRESHOLD = 0.5;

function zeroComponents(): MeditationComponents {
  return { alphaTemporal: 0, thetaFrontal: 0, betaFrontal: 0 };
}

function zeroIndices(): DerivedIndices {
  return {
    frontalAlphaAsymmetry: 0,
    thetaBetaRatioFrontal: 0,
    alphaBetaRatioTemporal: 0,
    engagement: 0,
    frontalTheta: 0,
  };
}

function zeroStateTime(): Record<MeditationState, number> {
  const out = {} as Record<MeditationState, number>;
  for (const s of MEDITATION_STATES) out[s] = 0;
  return out;
}

function summarize(samples: RecordingSample[]): RecordingSummary {
  if (samples.length === 0) {
    return {
      durationSec: 0,
      meanScore: 0,
      peakScore: 0,
      fractionMeditative: 0,
      meanComponents: zeroComponents(),
      meanIndices: zeroIndices(),
      stateTime: zeroStateTime(),
      samples,
    };
  }
  let sum = 0;
  let peak = -Infinity;
  let above = 0;
  const mc = zeroComponents();
  const mi = zeroIndices();
  const st = zeroStateTime();

  for (const s of samples) {
    sum += s.score;
    if (s.score > peak) peak = s.score;
    if (s.score > MEDITATIVE_THRESHOLD) above++;
    mc.alphaTemporal += s.components.alphaTemporal;
    mc.thetaFrontal  += s.components.thetaFrontal;
    mc.betaFrontal   += s.components.betaFrontal;
    mi.frontalAlphaAsymmetry  += s.indices.frontalAlphaAsymmetry;
    mi.thetaBetaRatioFrontal  += s.indices.thetaBetaRatioFrontal;
    mi.alphaBetaRatioTemporal += s.indices.alphaBetaRatioTemporal;
    mi.engagement             += s.indices.engagement;
    mi.frontalTheta           += s.indices.frontalTheta;
    st[s.state]++;
  }
  const n = samples.length;
  mc.alphaTemporal /= n;
  mc.thetaFrontal /= n;
  mc.betaFrontal /= n;
  mi.frontalAlphaAsymmetry  /= n;
  mi.thetaBetaRatioFrontal  /= n;
  mi.alphaBetaRatioTemporal /= n;
  mi.engagement             /= n;
  mi.frontalTheta           /= n;
  for (const s of MEDITATION_STATES) st[s] /= n;

  return {
    durationSec: samples[samples.length - 1].t,
    meanScore: sum / n,
    peakScore: peak,
    fractionMeditative: above / n,
    meanComponents: mc,
    meanIndices: mi,
    stateTime: st,
    samples,
  };
}
