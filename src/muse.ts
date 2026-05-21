import { MuseClient, EEGReading } from 'muse-js';
import { Subscription } from 'rxjs';

export const CHANNELS = ['TP9', 'AF7', 'AF8', 'TP10'] as const;
export const SAMPLE_RATE = 256;

export type Sample = { channel: number; value: number; timestamp: number };

export class MuseStream {
  private client = new MuseClient();
  private sub: Subscription | null = null;

  async connect(onSample: (s: Sample) => void): Promise<string> {
    await this.client.connect();
    await this.client.start();
    this.sub = this.client.eegReadings.subscribe((r: EEGReading) => {
      if (r.electrode > 3) return;
      const t0 = r.timestamp;
      for (let i = 0; i < r.samples.length; i++) {
        const v = r.samples[i];
        if (Number.isFinite(v)) {
          onSample({
            channel: r.electrode,
            value: v,
            timestamp: t0 + (i * 1000) / SAMPLE_RATE,
          });
        }
      }
    });
    return this.client.deviceName ?? 'Muse';
  }

  async disconnect() {
    this.sub?.unsubscribe();
    this.sub = null;
    try { this.client.disconnect(); } catch { /* ignore */ }
  }
}
