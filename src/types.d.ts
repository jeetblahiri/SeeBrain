declare module 'fft.js' {
  export default class FFT {
    constructor(size: number);
    size: number;
    createComplexArray(): number[];
    fromComplexArray(complex: number[], storage?: number[]): number[];
    toComplexArray(real: number[] | Float32Array, storage?: number[]): number[];
    transform(out: number[], data: number[]): void;
    realTransform(out: number[], data: number[] | Float32Array): void;
    completeSpectrum(spectrum: number[]): void;
    inverseTransform(out: number[], data: number[]): void;
  }
}
