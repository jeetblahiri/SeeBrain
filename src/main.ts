import { MuseStream, CHANNELS, SAMPLE_RATE } from './muse';
import {
  ChannelBuffer,
  BandPowerEstimator,
  FFT_SIZE,
  BAND_ORDER,
  BAND_HZ,
  BAND_LABEL,
  type Band,
  type WindowDiagnostics,
} from './signal';
import {
  TopoRenderer,
  buildCloudGrid,
  drawHeadOverlay,
  drawLegend,
  type ColorMode,
} from './topo';
import { TimeSeriesStrip } from './timeseries';
import { BaselineCollector, type BaselineStats } from './baseline';
import {
  computeZScores,
  meditationComponents,
  meditationScore,
  Recorder,
  type RecordingSummary,
} from './meditation';
import {
  classifyState,
  indicesFromZ,
  stateScores,
  MEDITATION_STATES,
  STATE_LABEL,
  STATE_COLOR,
  STATE_DESCRIPTION,
  type MeditationState,
} from './analysis';
import {
  listSessions,
  loadSession,
  deleteSession,
  renameSession,
  saveSession,
  newSessionId,
  migrateFromLocalStorage,
  type SessionMeta,
  type FullSession,
} from './db';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const connectBtn = $<HTMLButtonElement>('#connect');
const baselineBtn = $<HTMLButtonElement>('#baseline');
const recordBtn = $<HTMLButtonElement>('#record');
const statusEl = $<HTMLSpanElement>('#status');
const phaseEl = $<HTMLSpanElement>('#phase');
const recIndicator = $<HTMLSpanElement>('#rec-indicator');
const infoEl = $<HTMLSpanElement>('#info');
const qualityDots = Array.from(document.querySelectorAll<HTMLSpanElement>('.ts-cell .quality-dot'));
const bandGridEl = $<HTMLDivElement>('#band-grid');
const legendCanvas = $<HTMLCanvasElement>('#legend');
const legendLo = $<HTMLSpanElement>('#legend-lo');
const legendHi = $<HTMLSpanElement>('#legend-hi');
const legendNote = $<HTMLSpanElement>('#legend-note');

const bpEl = $<HTMLDivElement>('#baseline-progress');
const bpFill = $<HTMLDivElement>('#bp-fill');

const medPanel = $<HTMLElement>('#meditation-panel');
const medNeedle = $<HTMLDivElement>('#med-needle');
const compAlpha = $<HTMLSpanElement>('#comp-alpha');
const compTheta = $<HTMLSpanElement>('#comp-theta');
const compBeta = $<HTMLSpanElement>('#comp-beta');
const compScore = $<HTMLSpanElement>('#comp-score');
const idxFaa = $<HTMLSpanElement>('#idx-faa');
const idxTbr = $<HTMLSpanElement>('#idx-tbr');
const idxAbr = $<HTMLSpanElement>('#idx-abr');
const idxEng = $<HTMLSpanElement>('#idx-eng');
const stateChip = $<HTMLSpanElement>('#state-chip');
const stateDesc = $<HTMLDivElement>('#state-desc');
const sessionTimer = $<HTMLDivElement>('#session-timer');
const stTime = $<HTMLDivElement>('#st-time');
const stBuffer = $<HTMLDivElement>('#st-buffer');

const sessionsListEl = $<HTMLDivElement>('#sessions-list');
const sessionsCountEl = $<HTMLSpanElement>('#sessions-count');

const backBtn = $<HTMLButtonElement>('#back-btn');
const detailTitle = $<HTMLHeadingElement>('#detail-title');
const detailSubtitle = $<HTMLSpanElement>('#detail-subtitle');
const exportSummaryCsvBtn = $<HTMLButtonElement>('#export-summary-csv');
const exportRawCsvBtn = $<HTMLButtonElement>('#export-raw-csv');
const exportJsonBtn = $<HTMLButtonElement>('#export-json');
const deleteCurrentBtn = $<HTMLButtonElement>('#delete-current');
const renameCurrentBtn = $<HTMLButtonElement>('#rename-current');

const dSumDuration = $<HTMLDivElement>('#d-sum-duration');
const dSumMean = $<HTMLDivElement>('#d-sum-mean');
const dSumPeak = $<HTMLDivElement>('#d-sum-peak');
const dSumFrac = $<HTMLDivElement>('#d-sum-frac');
const dSumAlpha = $<HTMLDivElement>('#d-sum-alpha');
const dSumTheta = $<HTMLDivElement>('#d-sum-theta');
const dSumBeta = $<HTMLDivElement>('#d-sum-beta');
const dSumRaw = $<HTMLDivElement>('#d-sum-raw');
const dStateBar = $<HTMLDivElement>('#d-state-bar');
const dStateLegend = $<HTMLDivElement>('#d-state-legend');
const dSumSpark = $<HTMLCanvasElement>('#d-sum-spark');
const dSumFaa = $<HTMLDivElement>('#d-sum-faa');
const dSumTbr = $<HTMLDivElement>('#d-sum-tbr');
const dSumAbr = $<HTMLDivElement>('#d-sum-abr');
const dSumEng = $<HTMLDivElement>('#d-sum-eng');
const envCanvases = Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas.env'));

const TILE = 220;
const sharedGrid = buildCloudGrid(TILE, TILE);

type BandTile = {
  band: Band;
  renderer: TopoRenderer;
  vmin: number;
  vmax: number;
};

const tiles: BandTile[] = BAND_ORDER.map(band => {
  const tile = document.createElement('div');
  tile.className = 'band-tile';
  const wrap = document.createElement('div');
  wrap.className = 'topo-wrap';
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  wrap.appendChild(canvas);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(TILE));
  svg.setAttribute('height', String(TILE));
  svg.setAttribute('viewBox', `0 0 ${TILE} ${TILE}`);
  wrap.appendChild(svg);
  tile.appendChild(wrap);
  const label = document.createElement('div');
  label.className = 'band-label';
  const [lo, hi] = BAND_HZ[band];
  label.innerHTML = `${BAND_LABEL[band]}<span class="hz">${lo}–${hi} Hz</span>`;
  tile.appendChild(label);
  bandGridEl.appendChild(tile);
  drawHeadOverlay(svg, { labels: true, labelFontSize: 10, stroke: 1.4 });
  return { band, renderer: new TopoRenderer(canvas, sharedGrid), vmin: 0, vmax: 1 };
});

const buffers = [0, 1, 2, 3].map(() => new ChannelBuffer());
const estimator = new BandPowerEstimator();
const tsBuf = new Float32Array(FFT_SIZE);

const perChannelPowers: Record<Band, number>[] = [
  { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 },
  { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 },
  { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 },
  { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 },
];
const perChannelDiag: WindowDiagnostics[] = [
  { peakAbs: 0, rms: 0, hfRatio: 0 },
  { peakAbs: 0, rms: 0, hfRatio: 0 },
  { peakAbs: 0, rms: 0, hfRatio: 0 },
  { peakAbs: 0, rms: 0, hfRatio: 0 },
];
const tileValues = new Float32Array(4);

const stripColors = ['#4fa3ff', '#f0b429', '#3fb950', '#f85149'];
const tsCanvases = document.querySelectorAll<HTMLCanvasElement>('canvas.ts');
const strips: TimeSeriesStrip[] = [];
tsCanvases.forEach(c => {
  const ch = Number(c.dataset.ch);
  strips.push(new TimeSeriesStrip(c, stripColors[ch]));
});

let sampleCount = 0;
let lastSampleCountTs = performance.now();
let mute = true;
let rawScalesInitialized = false;

let baselineStats: BaselineStats | null = null;
const baselineCollector = new BaselineCollector(30, 10);
const recorder = new Recorder();

const rawBufs: number[][] = [[], [], [], []];
let recordingRaw = false;

const Z_RANGE = 3;
const colorMode = (): ColorMode => (baselineStats ? 'diverging' : 'sequential');

function setStatus(text: string, cls: 'connected' | 'disconnected' | 'connecting') {
  statusEl.textContent = text;
  statusEl.classList.remove('connected', 'disconnected', 'connecting');
  statusEl.classList.add(cls);
}
function setPhase(text: string) { phaseEl.textContent = text; }

function refreshLegend() {
  const mode = colorMode();
  drawLegend(legendCanvas, mode);
  if (mode === 'diverging') {
    legendLo.textContent = `−${Z_RANGE}σ`;
    legendHi.textContent = `+${Z_RANGE}σ`;
    legendNote.textContent = 'z-score vs baseline';
  } else {
    legendLo.textContent = 'low';
    legendHi.textContent = 'high';
    legendNote.textContent = 'per-band auto scale';
  }
}
refreshLegend();

const channelRmsSmoothed = [0, 0, 0, 0];
function updateQualityDots() {
  for (let c = 0; c < 4; c++) {
    const dot = qualityDots[c];
    if (!dot) continue;
    const r = channelRmsSmoothed[c];
    dot.classList.remove('q-good', 'q-fair', 'q-poor');
    if (r < 40) dot.classList.add('q-good');
    else if (r < 90) dot.classList.add('q-fair');
    else dot.classList.add('q-poor');
    dot.title = `${r.toFixed(0)} µV RMS — ${r < 40 ? 'good' : r < 90 ? 'fair' : 'poor'} contact`;
  }
}

const stream = new MuseStream();

connectBtn.addEventListener('click', async () => {
  if (!('bluetooth' in navigator)) {
    alert('Web Bluetooth not supported. Use Chrome or Edge.');
    return;
  }
  connectBtn.disabled = true;
  setStatus('Connecting…', 'connecting');
  try {
    const name = await stream.connect(sample => {
      buffers[sample.channel].push(sample.value);
      strips[sample.channel].push(sample.value);
      sampleCount++;
      if (recordingRaw) {
        rawBufs[sample.channel].push(sample.value);
      }
    });
    setStatus(`Connected — ${name}`, 'connected');
    mute = false;
    baselineBtn.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus('Disconnected', 'disconnected');
    connectBtn.disabled = false;
    alert(`Connect failed: ${(err as Error).message}`);
  }
});

baselineBtn.addEventListener('click', () => {
  if (baselineCollector.isActive()) return;
  baselineStats = null;
  recordBtn.disabled = true;
  baselineCollector.start();
  bpEl.classList.remove('hidden');
  bpFill.style.width = '0%';
  setPhase('Calibrating baseline…');
});

recordBtn.addEventListener('click', async () => {
  if (!baselineStats) return;
  if (recorder.isActive()) {
    recordingRaw = false;
    const summary = recorder.stop();
    sessionTimer.classList.add('hidden');
    recIndicator.classList.add('hidden');
    recordBtn.textContent = 'Record session';
    recordBtn.classList.remove('danger');

    const rawChannels: Float32Array[] = rawBufs.map(arr => Float32Array.from(arr));
    rawBufs[0].length = 0; rawBufs[1].length = 0; rawBufs[2].length = 0; rawBufs[3].length = 0;

    const meta: SessionMeta = {
      id: newSessionId(),
      name: defaultSessionName(),
      createdAt: new Date().toISOString(),
      durationSec: summary.durationSec,
      meanScore: summary.meanScore,
      fractionMeditative: summary.fractionMeditative,
      sampleHz: SAMPLE_RATE,
      channels: [...CHANNELS],
      totalRawSamples: rawChannels[0].length,
    };
    const full: FullSession = {
      meta, baseline: baselineStats!,
      summary,
      raw: { channels: rawChannels, sampleHz: SAMPLE_RATE },
    };
    try {
      await saveSession(full);
      await refreshSessionsList();
      gotoDetail(meta.id);
    } catch (e) {
      console.error('Failed to save session', e);
      alert(`Save failed: ${(e as Error).message}\nIndexedDB may be out of quota.`);
    }
  } else {
    recorder.start();
    recordingRaw = true;
    rawBufs[0].length = 0; rawBufs[1].length = 0; rawBufs[2].length = 0; rawBufs[3].length = 0;
    sessionTimer.classList.remove('hidden');
    recIndicator.classList.remove('hidden');
    recordBtn.textContent = 'Stop';
    recordBtn.classList.add('danger');
  }
});

function defaultSessionName(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tickTopo() {
  if (!mute && buffers.every(b => b.isReady())) {
    for (let c = 0; c < 4; c++) {
      buffers[c].snapshot(tsBuf);
      perChannelDiag[c] = estimator.analyze(tsBuf, perChannelPowers[c]);
      channelRmsSmoothed[c] = 0.7 * channelRmsSmoothed[c] + 0.3 * perChannelDiag[c].rms;
    }
    updateQualityDots();

    if (baselineCollector.isActive()) {
      const done = baselineCollector.push(perChannelPowers);
      bpFill.style.width = `${(baselineCollector.progress() * 100).toFixed(1)}%`;
      if (done) {
        baselineStats = baselineCollector.finalize();
        bpEl.classList.add('hidden');
        medPanel.classList.remove('hidden');
        recordBtn.disabled = false;
        setPhase('Baseline set · live z-score view');
        refreshLegend();
      }
    }

    const mode = colorMode();
    if (mode === 'diverging' && baselineStats) {
      const z = computeZScores(perChannelPowers, baselineStats);
      for (const tile of tiles) {
        for (let c = 0; c < 4; c++) tileValues[c] = z[tile.band][c];
        tile.renderer.render(tileValues, -Z_RANGE, Z_RANGE, 'diverging');
      }
      const comp = meditationComponents(z);
      const idx = indicesFromZ(z);
      const M = meditationScore(comp);
      const scores = stateScores(z);
      const state = classifyState(scores);

      compAlpha.textContent = comp.alphaTemporal.toFixed(2);
      compTheta.textContent = comp.thetaFrontal.toFixed(2);
      compBeta.textContent  = comp.betaFrontal.toFixed(2);
      compScore.textContent = M.toFixed(2);
      idxFaa.textContent = idx.frontalAlphaAsymmetry.toFixed(2);
      idxTbr.textContent = idx.thetaBetaRatioFrontal.toFixed(2);
      idxAbr.textContent = idx.alphaBetaRatioTemporal.toFixed(2);
      idxEng.textContent = idx.engagement.toFixed(2);

      stateChip.textContent = STATE_LABEL[state];
      stateChip.style.background = STATE_COLOR[state] + '33';
      stateChip.style.borderColor = STATE_COLOR[state];
      stateChip.style.color = STATE_COLOR[state];
      stateDesc.textContent = STATE_DESCRIPTION[state];

      const clamped = Math.max(-Z_RANGE, Math.min(Z_RANGE, M));
      const pct = ((clamped + Z_RANGE) / (2 * Z_RANGE)) * 100;
      medNeedle.style.left = `${pct}%`;

      if (recorder.isActive()) {
        recorder.push({ score: M, components: comp, indices: idx, state });
        const e = recorder.elapsed();
        const mm = Math.floor(e / 60).toString().padStart(2, '0');
        const ss = Math.floor(e % 60).toString().padStart(2, '0');
        stTime.textContent = `${mm}:${ss}`;
        const samples = rawBufs[0].length;
        const kb = ((samples * 4 * 4) / 1024).toFixed(0);
        stBuffer.textContent = `${samples.toLocaleString()} samples / ch · ~${kb} KB raw`;
      }
    } else {
      const alphaSmooth = 0.85;
      for (const tile of tiles) {
        for (let c = 0; c < 4; c++) tileValues[c] = perChannelPowers[c][tile.band];
        let mn = Infinity, mx = -Infinity;
        for (let c = 0; c < 4; c++) {
          if (tileValues[c] < mn) mn = tileValues[c];
          if (tileValues[c] > mx) mx = tileValues[c];
        }
        if (mx - mn < 0.1) mx = mn + 0.1;
        if (!rawScalesInitialized) {
          tile.vmin = mn;
          tile.vmax = mx;
        } else {
          tile.vmin = alphaSmooth * tile.vmin + (1 - alphaSmooth) * mn;
          tile.vmax = alphaSmooth * tile.vmax + (1 - alphaSmooth) * mx;
        }
        tile.renderer.render(tileValues, tile.vmin, tile.vmax, 'sequential');
      }
      rawScalesInitialized = true;
    }
  }
  setTimeout(tickTopo, 100);
}

function tickStrips() {
  for (const s of strips) s.draw();
  const now = performance.now();
  const dt = now - lastSampleCountTs;
  if (dt > 500) {
    const hzPerCh = (sampleCount / dt) * 1000 / 4;
    sampleCount = 0;
    lastSampleCountTs = now;
    infoEl.textContent = mute ? '' : `${hzPerCh.toFixed(0)} Hz/ch · ${CHANNELS.join(', ')}`;
  }
  requestAnimationFrame(tickStrips);
}

function renderStateBarInto(target: HTMLDivElement, legendTarget: HTMLDivElement, stateTime: Record<MeditationState, number>) {
  target.innerHTML = '';
  legendTarget.innerHTML = '';
  for (const s of MEDITATION_STATES) {
    const frac = stateTime[s];
    if (frac > 0) {
      const seg = document.createElement('div');
      seg.className = 'state-bar-seg';
      seg.style.background = STATE_COLOR[s];
      seg.style.flex = String(frac);
      if (frac > 0.08) seg.textContent = `${Math.round(frac * 100)}%`;
      seg.title = `${STATE_LABEL[s]}: ${(frac * 100).toFixed(1)}%`;
      target.appendChild(seg);
    }
  }
  for (const s of MEDITATION_STATES) {
    const item = document.createElement('span');
    item.className = 'state-legend-item';
    const dot = document.createElement('span');
    dot.className = 'state-legend-dot';
    dot.style.background = STATE_COLOR[s];
    item.appendChild(dot);
    item.appendChild(document.createTextNode(`${STATE_LABEL[s]} ${Math.round(stateTime[s] * 100)}%`));
    legendTarget.appendChild(item);
  }
}

function drawSparkInto(canvas: HTMLCanvasElement, s: RecordingSummary) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width > 0) canvas.width = Math.floor(rect.width);
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (s.samples.length < 2) return;
  const mid = H / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(W, mid);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(240,180,41,0.3)';
  const yAtHalf = mid - (0.5 / Z_RANGE) * (H * 0.45);
  ctx.beginPath();
  ctx.moveTo(0, yAtHalf);
  ctx.lineTo(W, yAtHalf);
  ctx.stroke();
  const tMax = s.samples[s.samples.length - 1].t || 1;
  const stripeH = 6;
  for (let i = 0; i < s.samples.length - 1; i++) {
    const a = s.samples[i];
    const b = s.samples[i + 1];
    const xa = (a.t / tMax) * W;
    const xb = (b.t / tMax) * W;
    ctx.fillStyle = STATE_COLOR[a.state] + 'aa';
    ctx.fillRect(xa, H - stripeH, Math.max(1, xb - xa), stripeH);
  }
  ctx.strokeStyle = '#4fa3ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < s.samples.length; i++) {
    const samp = s.samples[i];
    const x = (samp.t / tMax) * W;
    const y = mid - (Math.max(-Z_RANGE, Math.min(Z_RANGE, samp.score)) / Z_RANGE) * (H * 0.45);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(138,147,166,0.7)';
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillText('+3σ', 4, 12);
  ctx.fillText('0', 4, mid + 4);
  ctx.fillText('−3σ', 4, H - 10);
  ctx.fillText('M=0.5', W - 55, yAtHalf - 4);
}

function drawEnvelope(canvas: HTMLCanvasElement, data: Float32Array, color: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width > 0) canvas.width = Math.floor(rect.width);
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (data.length === 0) {
    ctx.fillStyle = 'rgba(138,147,166,0.5)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('no raw samples (legacy session)', 8, H / 2 + 4);
    return;
  }

  let dMean = 0;
  for (let i = 0; i < data.length; i++) dMean += data[i];
  dMean /= data.length;

  let amp = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i] - dMean);
    if (v > amp) amp = v;
  }
  amp = Math.max(20, amp);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();

  const samplesPerPx = Math.max(1, Math.floor(data.length / W));
  ctx.fillStyle = color;
  for (let x = 0; x < W; x++) {
    const start = x * samplesPerPx;
    const end = Math.min(data.length, start + samplesPerPx);
    if (start >= end) break;
    let mn = Infinity, mx = -Infinity;
    for (let i = start; i < end; i++) {
      const v = data[i] - dMean;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const yMax = H / 2 - (mx / amp) * (H * 0.45);
    const yMin = H / 2 - (mn / amp) * (H * 0.45);
    ctx.fillRect(x, yMax, 1, Math.max(1, yMin - yMax));
  }

  ctx.fillStyle = 'rgba(138,147,166,0.7)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(`±${amp.toFixed(0)} µV`, 4, 12);
}

function renderDetailView(session: FullSession) {
  detailTitle.textContent = session.meta.name;
  const created = new Date(session.meta.createdAt);
  detailSubtitle.textContent = `${created.toLocaleString()} · ${session.meta.totalRawSamples.toLocaleString()} samples per channel @ ${session.meta.sampleHz} Hz`;

  const s = session.summary;
  const mm = Math.floor(s.durationSec / 60).toString().padStart(2, '0');
  const ss = Math.floor(s.durationSec % 60).toString().padStart(2, '0');
  dSumDuration.textContent = `${mm}:${ss}`;
  dSumMean.textContent = s.meanScore.toFixed(2);
  dSumPeak.textContent = s.peakScore.toFixed(2);
  dSumFrac.textContent = `${(s.fractionMeditative * 100).toFixed(0)}%`;
  dSumAlpha.textContent = s.meanComponents.alphaTemporal.toFixed(2);
  dSumTheta.textContent = s.meanComponents.thetaFrontal.toFixed(2);
  dSumBeta.textContent  = s.meanComponents.betaFrontal.toFixed(2);
  dSumRaw.textContent   = session.meta.totalRawSamples > 0
    ? `${(session.meta.totalRawSamples / session.meta.sampleHz).toFixed(0)} s × 4 ch`
    : '— (legacy)';
  dSumFaa.textContent = s.meanIndices.frontalAlphaAsymmetry.toFixed(2);
  dSumTbr.textContent = s.meanIndices.thetaBetaRatioFrontal.toFixed(2);
  dSumAbr.textContent = s.meanIndices.alphaBetaRatioTemporal.toFixed(2);
  dSumEng.textContent = s.meanIndices.engagement.toFixed(2);

  renderStateBarInto(dStateBar, dStateLegend, s.stateTime);
  drawSparkInto(dSumSpark, s);

  for (let c = 0; c < 4; c++) {
    if (envCanvases[c]) {
      drawEnvelope(envCanvases[c], session.raw.channels[c], stripColors[c]);
    }
  }
}

let currentSession: FullSession | null = null;

function gotoLive() {
  currentSession = null;
  document.body.setAttribute('data-view', 'live');
  if (location.hash !== '' && location.hash !== '#/' && location.hash !== '#/live') {
    location.hash = '';
  }
}

function gotoDetail(id: string) {
  location.hash = `#/session/${id}`;
}

async function applyHashRoute() {
  const h = location.hash.replace(/^#/, '');
  const m = h.match(/^\/session\/(.+)$/);
  if (m) {
    const id = m[1];
    const full = await loadSession(id);
    if (!full) {
      alert('Session not found.');
      gotoLive();
      return;
    }
    currentSession = full;
    document.body.setAttribute('data-view', 'detail');
    renderDetailView(full);
    window.scrollTo({ top: 0 });
  } else {
    gotoLive();
  }
}

window.addEventListener('hashchange', () => { applyHashRoute(); });

backBtn.addEventListener('click', () => { gotoLive(); });

renameCurrentBtn.addEventListener('click', async () => {
  if (!currentSession) return;
  const newName = (prompt(`Rename session:`, currentSession.meta.name) ?? '').trim();
  if (!newName || newName === currentSession.meta.name) return;
  try {
    await renameSession(currentSession.meta.id, newName);
    currentSession.meta.name = newName;
    detailTitle.textContent = newName;
    await refreshSessionsList();
  } catch (e) {
    alert(`Rename failed: ${(e as Error).message}`);
  }
});

deleteCurrentBtn.addEventListener('click', async () => {
  if (!currentSession) return;
  if (!confirm(`Delete session "${currentSession.meta.name}"? This cannot be undone.`)) return;
  await deleteSession(currentSession.meta.id);
  await refreshSessionsList();
  gotoLive();
});

exportSummaryCsvBtn.addEventListener('click', () => {
  if (!currentSession) return;
  downloadCsv(buildSummaryCsv(currentSession), `${slug(currentSession.meta.name)}-summary.csv`);
});

exportRawCsvBtn.addEventListener('click', () => {
  if (!currentSession) return;
  if (currentSession.meta.totalRawSamples === 0) {
    alert('This session has no raw samples (legacy migration).');
    return;
  }
  downloadCsv(buildRawCsv(currentSession), `${slug(currentSession.meta.name)}-raw.csv`);
});

exportJsonBtn.addEventListener('click', () => {
  if (!currentSession) return;
  const dump = {
    meta: currentSession.meta,
    baseline: currentSession.baseline,
    summary: currentSession.summary,
    raw: {
      sampleHz: currentSession.raw.sampleHz,
      channels: CHANNELS.map((name, c) => ({ name, samples: Array.from(currentSession!.raw.channels[c]) })),
    },
  };
  const blob = new Blob([JSON.stringify(dump)], { type: 'application/json' });
  triggerDownload(blob, `${slug(currentSession.meta.name)}.json`);
});

function slug(name: string): string {
  return name.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'session';
}

function buildSummaryCsv(session: FullSession): string {
  const rows: string[] = [];
  rows.push('t_sec,M,alpha_temporal,theta_frontal,beta_frontal,faa,tbr_frontal,abr_temp_front,engagement,frontal_theta,state');
  for (const s of session.summary.samples) {
    rows.push([
      s.t.toFixed(3),
      s.score.toFixed(4),
      s.components.alphaTemporal.toFixed(4),
      s.components.thetaFrontal.toFixed(4),
      s.components.betaFrontal.toFixed(4),
      s.indices.frontalAlphaAsymmetry.toFixed(4),
      s.indices.thetaBetaRatioFrontal.toFixed(4),
      s.indices.alphaBetaRatioTemporal.toFixed(4),
      s.indices.engagement.toFixed(4),
      s.indices.frontalTheta.toFixed(4),
      s.state,
    ].join(','));
  }
  return rows.join('\n');
}

function buildRawCsv(session: FullSession): string {
  const ch = session.raw.channels;
  const hz = session.raw.sampleHz || SAMPLE_RATE;
  const n = ch[0].length;
  const rows: string[] = [];
  rows.push(`t_sec,${session.meta.channels.join(',')}`);
  for (let i = 0; i < n; i++) {
    const t = (i / hz).toFixed(5);
    rows.push(`${t},${ch[0][i].toFixed(3)},${ch[1][i].toFixed(3)},${ch[2][i].toFixed(3)},${ch[3][i].toFixed(3)}`);
  }
  return rows.join('\n');
}

function downloadCsv(content: string, filename: string) {
  triggerDownload(new Blob([content], { type: 'text/csv;charset=utf-8' }), filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function refreshSessionsList() {
  const metas = await listSessions();
  sessionsCountEl.textContent = metas.length === 0 ? '' : `${metas.length} session${metas.length === 1 ? '' : 's'}`;
  sessionsListEl.innerHTML = '';
  if (metas.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sessions-empty';
    empty.textContent = 'No saved sessions yet. Record one to begin.';
    sessionsListEl.appendChild(empty);
    return;
  }
  for (const m of metas) {
    const row = document.createElement('div');
    row.className = 'session-row';

    const name = document.createElement('span');
    name.className = 'session-name';
    name.textContent = m.name;
    row.appendChild(name);

    const date = document.createElement('span');
    date.className = 'session-date';
    date.textContent = new Date(m.createdAt).toLocaleDateString();
    row.appendChild(date);

    const dur = document.createElement('span');
    dur.className = 'session-stat';
    const mm = Math.floor(m.durationSec / 60).toString().padStart(2, '0');
    const ss = Math.floor(m.durationSec % 60).toString().padStart(2, '0');
    dur.textContent = `${mm}:${ss}`;
    row.appendChild(dur);

    const score = document.createElement('span');
    score.className = 'session-stat';
    score.textContent = `M̄ ${m.meanScore.toFixed(2)}`;
    row.appendChild(score);

    const actions = document.createElement('span');
    actions.className = 'session-actions';

    const viewBtn = document.createElement('button');
    viewBtn.className = 'ghost-btn';
    viewBtn.textContent = 'View';
    viewBtn.addEventListener('click', () => { gotoDetail(m.id); });

    const renameBtn = document.createElement('button');
    renameBtn.className = 'ghost-btn';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newName = (prompt(`Rename session:`, m.name) ?? '').trim();
      if (!newName || newName === m.name) return;
      try {
        await renameSession(m.id, newName);
        await refreshSessionsList();
      } catch (err) {
        alert(`Rename failed: ${(err as Error).message}`);
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'ghost-btn';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete session "${m.name}"?`)) return;
      await deleteSession(m.id);
      await refreshSessionsList();
    });

    actions.appendChild(viewBtn);
    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);
    row.appendChild(actions);

    sessionsListEl.appendChild(row);
  }
}

(async () => {
  try {
    const n = await migrateFromLocalStorage();
    if (n > 0) console.info(`Migrated ${n} session(s) from localStorage to IndexedDB.`);
  } catch (e) {
    console.warn('migration error', e);
  }
  await refreshSessionsList();
  await applyHashRoute();
  tickTopo();
  requestAnimationFrame(tickStrips);
})();

window.addEventListener('beforeunload', () => { stream.disconnect(); });
