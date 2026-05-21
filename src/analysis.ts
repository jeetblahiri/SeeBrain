import { CH_AF7, CH_AF8, CH_TP9, CH_TP10, type ZScoreMap } from './meditation';

export const MEDITATION_STATES = ['relaxed', 'focused', 'aroused', 'drowsy', 'neutral'] as const;
export type MeditationState = typeof MEDITATION_STATES[number];

export type StateScores = Record<MeditationState, number>;

export type DerivedIndices = {
  frontalAlphaAsymmetry: number;
  thetaBetaRatioFrontal: number;
  alphaBetaRatioTemporal: number;
  engagement: number;
  frontalTheta: number;
};

const mean = (arr: number[], idxs: number[]): number => {
  let s = 0;
  for (const i of idxs) s += arr[i];
  return s / idxs.length;
};

export function indicesFromZ(z: ZScoreMap): DerivedIndices {
  const aT = mean(z.alpha, [CH_TP9, CH_TP10]);
  const aF = mean(z.alpha, [CH_AF7, CH_AF8]);
  const tF = mean(z.theta, [CH_AF7, CH_AF8]);
  const bF = mean(z.beta,  [CH_AF7, CH_AF8]);

  return {
    frontalAlphaAsymmetry: z.alpha[CH_AF8] - z.alpha[CH_AF7],
    thetaBetaRatioFrontal: tF - bF,
    alphaBetaRatioTemporal: aT - bF,
    engagement: bF - 0.5 * (aF + tF),
    frontalTheta: tF,
  };
}

export function stateScores(z: ZScoreMap): StateScores {
  const aT = mean(z.alpha, [CH_TP9, CH_TP10]);
  const aF = mean(z.alpha, [CH_AF7, CH_AF8]);
  const tF = mean(z.theta, [CH_AF7, CH_AF8]);
  const bF = mean(z.beta,  [CH_AF7, CH_AF8]);
  const dAll = mean(z.delta, [0, 1, 2, 3]);
  const tAll = mean(z.theta, [0, 1, 2, 3]);

  const relaxed = 0.6 * aT + 0.2 * aF - 0.4 * bF;
  const focused = 0.7 * tF + 0.2 * aF - 0.3 * bF;
  const aroused = 0.7 * bF - 0.5 * aT - 0.3 * aF;
  const drowsy  = 0.4 * dAll + 0.3 * tAll - 0.4 * aT - 0.2 * aF;

  const totalDev = (Math.abs(aT) + Math.abs(aF) + Math.abs(tF) + Math.abs(bF) + Math.abs(dAll)) / 5;
  const neutral = 0.6 - totalDev;

  return { relaxed, focused, aroused, drowsy, neutral };
}

const STATE_THRESHOLD = 0.4;

export function classifyState(scores: StateScores): MeditationState {
  let best: MeditationState = 'neutral';
  let bestVal = scores.neutral;
  for (const s of ['relaxed', 'focused', 'aroused', 'drowsy'] as const) {
    if (scores[s] > bestVal && scores[s] > STATE_THRESHOLD) {
      best = s;
      bestVal = scores[s];
    }
  }
  return best;
}

export const STATE_LABEL: Record<MeditationState, string> = {
  relaxed: 'Relaxed',
  focused: 'Focused',
  aroused: 'Aroused',
  drowsy:  'Drowsy',
  neutral: 'Neutral',
};

export const STATE_DESCRIPTION: Record<MeditationState, string> = {
  relaxed: 'Alpha enhancement at temporal sites with frontal beta suppression — relaxed wakefulness (Cahn & Polich 2006).',
  focused: 'Frontal-midline theta increase with beta suppression — sustained focused attention (Aftanas & Golocheikine 2001).',
  aroused: 'Beta dominance with alpha suppression — heightened cortical arousal, mind-wandering, or stress.',
  drowsy:  'Global delta/theta increase without alpha enhancement — sleep onset / hypnagogic, not meditative absorption.',
  neutral: 'Within ~0.4 σ of your baseline — no clear state.',
};

export const STATE_COLOR: Record<MeditationState, string> = {
  relaxed: '#3fb950',
  focused: '#f0b429',
  aroused: '#f85149',
  drowsy:  '#4fa3ff',
  neutral: '#8a93a6',
};

export const INDEX_LABEL: Record<keyof DerivedIndices, string> = {
  frontalAlphaAsymmetry: 'Frontal α asymmetry (AF8−AF7)',
  thetaBetaRatioFrontal: 'θ/β ratio frontal',
  alphaBetaRatioTemporal: 'α/β ratio (temp/front)',
  engagement: 'Engagement β/(α+θ) frontal',
  frontalTheta: 'Frontal-midline θ',
};

export const INDEX_NOTE: Record<keyof DerivedIndices, string> = {
  frontalAlphaAsymmetry: 'Positive = relative left-frontal activation, often linked to approach affect / positive valence (Coan & Allen 2004).',
  thetaBetaRatioFrontal: 'Elevated during internally directed attention. Distinguish from drowsiness via alpha.',
  alphaBetaRatioTemporal: 'Higher = relaxation index.',
  engagement: 'Higher = aroused/engaged; lower = relaxed/withdrawn (Pope, Bogart, Bartolome 1995).',
  frontalTheta: 'Marker of focused-attention meditation; rises with sustained concentration.',
};
