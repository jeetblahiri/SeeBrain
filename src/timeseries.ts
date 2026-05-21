import { SAMPLE_RATE } from './muse';

const WINDOW_SEC = 4;
const N = SAMPLE_RATE * WINDOW_SEC;

export class TimeSeriesStrip {
  private ctx: CanvasRenderingContext2D;
  private buf = new Float32Array(N);
  private writeIdx = 0;
  private filled = 0;
  private W: number;
  private H: number;

  constructor(private canvas: HTMLCanvasElement, private color: string) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    this.ctx = ctx;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0) canvas.width = Math.floor(rect.width);
    this.W = canvas.width;
    this.H = canvas.height;
  }

  push(value: number) {
    this.buf[this.writeIdx] = value;
    this.writeIdx = (this.writeIdx + 1) % N;
    if (this.filled < N) this.filled++;
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);

    ctx.strokeStyle = '#1f2530';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, this.H / 2);
    ctx.lineTo(this.W, this.H / 2);
    ctx.stroke();

    if (this.filled < 4) return;

    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < this.filled; i++) {
      const v = this.buf[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const span = Math.max(20, mx - mn);
    const mid = (mn + mx) / 2;

    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const stepX = this.W / (N - 1);
    let j = this.writeIdx;
    for (let i = 0; i < N; i++) {
      const v = this.buf[j];
      const y = this.H / 2 - ((v - mid) / span) * (this.H * 0.85);
      const x = i * stepX;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      j = (j + 1) % N;
    }
    ctx.stroke();
  }
}
