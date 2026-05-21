import FFT from 'fft.js';
import { SAMPLE_RATE } from './muse';

export type Band = 'delta' | 'theta' | 'alpha' | 'beta' | 'gamma';

export const BAND_ORDER: Band[] = ['delta', 'theta', 'alpha', 'beta', 'gamma'];

export const BAND_HZ: Record<Band, [number, number]> = {
  delta: [1, 4],
  theta: [4, 8],
  alpha: [8, 13],
  beta: [13, 30],
  gamma: [30, 50],
};

export const BAND_LABEL: Record<Band, string> = {
  delta: 'Delta',
  theta: 'Theta',
  alpha: 'Alpha',
  beta: 'Beta',
  gamma: 'Gamma',
};

const FFT_SIZE = 256;

function hamming(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  return w;
}

export class ChannelBuffer {
  private buf = new Float32Array(FFT_SIZE);
  private writeIdx = 0;
  private filled = 0;
  private dc = 0;

  push(value: number): void {
    if (this.filled === 0) {
      this.dc = value;
    } else {
      this.dc = 0.999 * this.dc + 0.001 * value;
    }
    this.buf[this.writeIdx] = value - this.dc;
    this.writeIdx = (this.writeIdx + 1) % FFT_SIZE;
    if (this.filled < FFT_SIZE) this.filled++;
  }

  isReady(): boolean { return this.filled >= FFT_SIZE; }

  snapshot(out: Float32Array): void {
    let j = this.writeIdx;
    for (let i = 0; i < FFT_SIZE; i++) {
      out[i] = this.buf[j];
      j = (j + 1) % FFT_SIZE;
    }
  }

  recent(n: number, out: Float32Array): void {
    const N = Math.min(n, FFT_SIZE);
    let j = (this.writeIdx - N + FFT_SIZE) % FFT_SIZE;
    for (let i = 0; i < N; i++) {
      out[i] = this.buf[j];
      j = (j + 1) % FFT_SIZE;
    }
  }
}

export class BandPowerEstimator {
  private fft = new FFT(FFT_SIZE);
  private window = hamming(FFT_SIZE);
  private inBuf = new Float32Array(FFT_SIZE);
  private windowed = this.fft.createComplexArray() as unknown as number[];
  private outBuf = this.fft.createComplexArray() as unknown as number[];
  private windowCorrection: number;

  constructor() {
    let sum = 0;
    for (let i = 0; i < FFT_SIZE; i++) sum += this.window[i] * this.window[i];
    this.windowCorrection = sum / FFT_SIZE;
  }

  computeAll(samples: Float32Array, out: Record<Band, number>): void {
    this.analyze(samples, out);
  }

  analyze(samples: Float32Array, powersOut: Record<Band, number>): WindowDiagnostics {
    for (let i = 0; i < FFT_SIZE; i++) {
      this.windowed[2 * i] = samples[i] * this.window[i];
      this.windowed[2 * i + 1] = 0;
    }
    this.fft.transform(this.outBuf, this.windowed);

    const normalize = FFT_SIZE * FFT_SIZE * this.windowCorrection;
    const nyquistBin = FFT_SIZE / 2;
    const hfLoBin = Math.floor((HF_LOW_HZ * FFT_SIZE) / SAMPLE_RATE);

    for (const band of BAND_ORDER) {
      const [lo, hi] = BAND_HZ[band];
      const binLo = Math.max(1, Math.floor((lo * FFT_SIZE) / SAMPLE_RATE));
      const binHi = Math.min(nyquistBin, Math.ceil((hi * FFT_SIZE) / SAMPLE_RATE));
      let power = 0;
      for (let k = binLo; k <= binHi; k++) {
        const re = this.outBuf[2 * k];
        const im = this.outBuf[2 * k + 1];
        power += re * re + im * im;
      }
      powersOut[band] = Math.log10(power / normalize + 1e-6);
    }

    let totalPower = 0;
    let hfPower = 0;
    for (let k = 1; k <= nyquistBin; k++) {
      if ((k >= 48 && k <= 52) || (k >= 58 && k <= 62)) continue;
      const re = this.outBuf[2 * k];
      const im = this.outBuf[2 * k + 1];
      const p = re * re + im * im;
      totalPower += p;
      if (k >= hfLoBin) hfPower += p;
    }
    const hfRatio = totalPower > 0 ? hfPower / totalPower : 0;

    let mean = 0;
    for (let i = 0; i < samples.length; i++) mean += samples[i];
    mean /= samples.length;

    let peakAbs = 0;
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i] - mean;
      const a = v < 0 ? -v : v;
      if (a > peakAbs) peakAbs = a;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / samples.length);

    return { peakAbs, rms, hfRatio };
  }
}

const HF_LOW_HZ = 55;

export type WindowDiagnostics = {
  peakAbs: number;
  rms: number;
  hfRatio: number;
};

export { FFT_SIZE };
