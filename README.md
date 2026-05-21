# SeeBrain

A web-based, real-time EEG visualizer and multi-state meditation analyzer for the **Muse 2** headband. Streams raw 256 Hz EEG over Web Bluetooth directly to your browser — no Python bridge, no Mind Monitor, no LSL — and renders frontal + temporal cortical activity as smooth band-resolved topographic clouds. Records sessions to IndexedDB with **full raw signal preserved** so you can re-analyze them later.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Prerequisites](#prerequisites)
3. [Install and run](#install-and-run)
4. [How to operate it](#how-to-operate-it)
5. [Methodology](#methodology)
6. [Navigating between live and recordings](#navigating-between-live-and-recordings)
7. [Exporting your data](#exporting-your-data)
8. [Where recordings are stored](#where-recordings-are-stored)
9. [Architecture](#architecture)
10. [Limitations and honest caveats](#limitations-and-honest-caveats)
11. [Development notes](#development-notes)
12. [License](#license)

---

## What it does

- **Direct Web Bluetooth streaming** from a Muse 2 (4 channels: TP9, AF7, AF8, TP10 at 256 Hz) using `muse-js@3.3.0`.
- **Localized topographic clouds** for each EEG band (Delta, Theta, Alpha, Beta, Gamma) — Gaussian-kernelled and gated to electrode neighborhoods, so frontal (AF7+AF8) merges into one blob and TP9 / TP10 stay anatomically isolated. No fake interpolation across the unmeasured center/occipital scalp.
- **Baseline calibration**: a 30 s eyes-closed resting recording establishes per-channel, per-band mean μ and SD σ of log-power.
- **Live z-score view**: after baseline, the topo colors switch from per-band auto-scale (viridis) to a diverging RdBu_r colormap centered on your baseline — blue = below baseline, red = above. Color now means *deviation in standard deviations*, which is scientifically interpretable.
- **Multi-state meditation analyzer** classifies each window into one of five literature-backed states: Relaxed, Focused, Aroused, Drowsy, Neutral.
- **Derived indices** including Frontal Alpha Asymmetry, θ/β ratio (frontal), α/β ratio (temporal vs. frontal), and an engagement index β/(α+θ).
- **Per-channel contact-quality dots** next to the raw-signal strips (green/amber/red, driven by rolling RMS).
- **Persistent sessions in IndexedDB** with the full 256 Hz raw EEG per channel + the 10 Hz analysis time series. Sessions survive reloads and can be re-opened weeks later.
- **Live ↔ Detail navigation** via URL hash routing (`#/` and `#/session/<id>`) so browser back/forward work.
- **CSV / JSON export** of any saved session.
- **Rename / delete** any session from either the list or the detail view.

---

## Prerequisites

- **Muse 2 headband**, charged, on your head, **not currently paired with the Muse mobile app** (BLE is exclusive — you can only have one client connected to the headband at a time).
- **Chrome or Edge** — Web Bluetooth is not supported in Safari or Firefox.
- **macOS, Windows, Linux, or Android.** On macOS, make sure Chrome has Bluetooth permission in *System Settings → Privacy & Security → Bluetooth*.
- **Node.js 18+** and **npm** for local development.

---

## Install and run

```bash
git clone https://github.com/jeetblahiri/SeeBrain.git
cd SeeBrain
npm install
npm run dev
```

Then open the URL printed by Vite (usually `http://localhost:5173`) in Chrome or Edge.

Production build:

```bash
npm run build      # outputs to dist/
npm run preview    # serves the built bundle for sanity check
```

---

## How to operate it

The UI is one page with a toolbar at the top. The intended order of operation is left to right.

### 1. Connect

Click **Connect Muse**. A browser dialog will list nearby Bluetooth devices — pick yours (it usually shows up as `Muse-XXXX`). The status pill turns green and you should see real-time waveforms in the four channel strips at the bottom.

If nothing appears: check that the Muse app is *closed*, the headband is on and blinking, and your browser has Bluetooth permission at the OS level.

### 2. Calibrate baseline

Once connected, click **Set baseline (30 s)**. A progress bar appears with the instruction "sit still, eyes closed, breathe normally." Hold this position for 30 seconds. The app computes μ and σ for every (band × channel) pair across this window.

When done, the **Meditativeness vs baseline** panel slides in, the band topos switch to z-score mode (diverging colormap), and the Record button unlocks.

### 3. Live read

You'll see, in real time:

- Five mini topographic maps — one per band — colored by current z-score per electrode against your baseline.
- A **meditativeness meter** showing composite M (range ±3 σ).
- A **state chip** ("Relaxed" / "Focused" / "Aroused" / "Drowsy" / "Neutral") with the literature-grounded definition underneath.
- Numerical readouts of all components and derived indices.
- Four raw-signal strips with per-channel contact-quality dots.

### 4. Record a session

Click **Record session** when you want to start logging. The button turns red, a "REC" indicator pulses, the elapsed-time timer appears, and an updating "samples / KB" counter shows your raw buffer growing.

Click **Stop** to end recording. The session is saved to IndexedDB and you're navigated to its detail page automatically.

### 5. Review and analyze

The **detail view** shows:

- Summary tiles (duration, mean M, peak M, % time meditative, mean components, mean per-channel α/θ/β, raw sample count).
- A **state breakdown bar** showing what fraction of the session was spent in each state.
- An **M-over-time sparkline** with color-coded state stripe underneath — see *when* you slipped into each state, not just the totals.
- A **derived-indices grid** with notes on each one's interpretation.
- **Per-channel raw EEG envelope** drawn from the full 256 Hz signal — min/max amplitude per pixel column across the entire session. Lets you spot blinks, drift, and overall amplitude trends.

From here you can **Rename**, **Delete**, or **Export** (CSV summary, CSV raw, full JSON).

### 6. Navigate

- **Saved sessions** list at the bottom of the live view shows everything you've recorded with date, duration, and mean M, plus inline View / Rename / Delete buttons.
- Click **View** to switch to that session's detail page (or paste a `#/session/<id>` URL).
- Click **← Back to live** in the detail header (or use the browser back button) to return.

---

## Methodology

> If you're using SeeBrain for actual analysis, please read this section.

### Baseline statistics

A 30 s eyes-closed baseline establishes, for each (band, channel) pair, the mean μ and SD σ of the log-power. Log-power is preferred over raw power because EEG band power is approximately log-normally distributed.

### z-score view

Every live window's per-(band, channel) log-power is transformed to z = (logP − μ) / σ. Topographic clouds use these z-scores on a diverging RdBu_r colormap clamped to ±3 σ. Gray = at baseline; blue = below; red = above.

### Composite "meditativeness" M

A weighted sum of three z-score components:

```
M = 0.4 · z_α(temporal)  +  0.3 · z_θ(frontal)  −  0.3 · z_β(frontal)
```

Rationale:

- **z_α(temporal)** = mean z-score of alpha at TP9 and TP10. Alpha enhancement in temporo-parietal regions tracks relaxed wakefulness (Cahn & Polich, *Psychol Bull* 2006). TP9 / TP10 are the closest approximation Muse 2 gives to posterior alpha — see caveats below.
- **z_θ(frontal)** = mean z-score of theta at AF7 and AF8. Frontal-midline theta increases during focused attention meditation (Aftanas & Golocheikine, *Neurosci Lett* 2001).
- **z_β(frontal)** = mean z-score of beta at AF7 and AF8. Beta typically *decreases* with reduced cognitive load and mind-wandering, hence the negative weight.

### Five-state classifier

Each accepted window is classified into the highest-scoring of five states (or Neutral if no state exceeds 0.4 σ of evidence):

| State | Markers | Citation |
|---|---|---|
| **Relaxed** | temporal α↑, frontal β↓ | Cahn & Polich 2006 |
| **Focused** | frontal θ↑, frontal β↓ | Aftanas & Golocheikine 2001 |
| **Aroused** | frontal β↑, α↓ | classic stress / mind-wandering signature |
| **Drowsy** | global δ+θ↑ *without* α enhancement | hypnagogic, not absorption |
| **Neutral** | all within ≈ 0.4 σ of baseline | baseline-like |

The **Drowsy ≠ Focused** distinction matters: both show theta increases, but only meditative absorption also shows alpha enhancement at temporal sites. The classifier weights its inputs to keep them separable.

### Derived indices

All expressed in baseline-σ units:

- **Frontal Alpha Asymmetry (FAA)** = z_α[AF8] − z_α[AF7]. Positive → relative left-frontal activation; classically linked to approach motivation and positive affect (Coan & Allen, *Biol Psychol* 2004).
- **θ/β ratio (frontal)** = z_θ(frontal) − z_β(frontal). Elevated during internally directed attention — but also elevated in drowsiness, so read alongside the state classifier.
- **α/β ratio (temporal vs. frontal)** = z_α(temporal) − z_β(frontal). Relaxation index.
- **Engagement** = z_β(frontal) − ½·(z_α(frontal) + z_θ(frontal)). High = aroused/engaged; low = withdrawn/relaxed (Pope, Bogart & Bartolome 1995).

### Artifact handling

We **do not reject windows**. Mirroring the Muse app's behavior, all windows enter both baseline and analysis — running statistics over 30 s naturally dilute transient blinks and movement. Per-channel contact-quality dots (rolling RMS thresholded at 40 µV and 90 µV) flag individual bad electrodes so you know which one to reseat, rather than blanket-discrediting the headset.

### Signal processing chain (per channel)

1. Adaptive DC remover initialized to the first sample for instant convergence.
2. 256-sample ring buffer (1 s of data).
3. Hamming-windowed radix-2 FFT.
4. Band-integrated log-power for δ (1–4 Hz), θ (4–8), α (8–13), β (13–30), γ (30–50).
5. z-score against baseline μ/σ if baseline is set.
6. Indices and state classification.
7. Topo cloud rendering at ≈ 10 Hz.

---

## Navigating between live and recordings

Routes are URL-hash based:

| URL hash | View |
|---|---|
| `` or `#/` or `#/live` | Live recording view |
| `#/session/<id>` | Detail page for a saved session |

The detail page is opened from the **View** button on a session row, automatically when you stop a recording, or by direct hash URL. **← Back to live**, the browser back button, or clicking another session's View all work as expected.

---

## Exporting your data

In the detail view header:

- **Export summary CSV** — 10 Hz analysis time series. Columns: `t_sec, M, alpha_temporal, theta_frontal, beta_frontal, faa, tbr_frontal, abr_temp_front, engagement, frontal_theta, state`. Small file, opens in Excel / Pandas / R immediately.
- **Export raw CSV** — full 256 Hz × 4 channels. Columns: `t_sec, TP9, AF7, AF8, TP10`. Use for spectral re-analysis, ICA, your own classifiers, ML datasets, etc. File size scales with session duration (~ 1 MB / minute).
- **Export JSON** — complete dump including baseline μ/σ, full analysis time series, and raw arrays. Round-trips into other JS analysis tools.

Files are downloaded via a Blob + object URL — no server is involved at any point.

---

## Where recordings are stored

Sessions live in your browser's **IndexedDB** under database name `seebrain`, with two object stores: `meta` (indexed listing) and `full` (baseline + summary + raw `Float32Array`s).

This means:

- **All data is on your machine, in your browser profile.** Nothing is sent anywhere.
- Clearing your browser's site data wipes all SeeBrain recordings.
- Different browsers / profiles have independent storage.
- The repository **does not contain any recorded files** — there's nothing on the filesystem to push. Browser IDB is not part of the source tree.

If you want offsite copies, use the Export buttons.

---

## Architecture

```
src/
├── main.ts          Orchestrates everything: UI wiring, per-tick analysis loop,
│                    recording lifecycle, hash routing, detail view rendering,
│                    CSV/JSON export, sessions list management.
├── muse.ts          muse-js connection wrapper. Per-sample callback.
├── signal.ts        Ring buffer with adaptive DC removal; Hamming-windowed FFT;
│                    BandPowerEstimator.analyze returns per-band log-power +
│                    WindowDiagnostics { peakAbs, rms, hfRatio } from one FFT.
│                    HF computation notches out 48–52 / 58–62 Hz mains bins.
├── baseline.ts      30 s baseline collector → per-(band, channel) μ/σ.
├── meditation.ts    Composite M score, z-score map, Recorder class with full
│                    10 Hz timeline of {t, M, components, indices, state}.
├── analysis.ts      Five-state classifier and derived indices.
├── artifacts.ts     Threshold definitions (kept as utility; no longer gates).
├── topo.ts          Gaussian cloud renderer gated to electrode neighborhoods;
│                    head outline SVG; viridis + RdBu_r colormaps.
├── timeseries.ts    Scrolling raw-signal strips with autoscale.
├── db.ts            IndexedDB wrapper. Two stores. saveSession / loadSession /
│                    listSessions / renameSession / deleteSession. One-time
│                    migration from old localStorage schema.
├── types.d.ts       Ambient types for fft.js (no @types package upstream).
└── styles.css       All styling; data-view attribute on <body> switches
                     live ↔ detail layouts.
```

**Tech stack:** Vite 5, TypeScript 5 (strict), `muse-js@3.3.0`, `rxjs@6` (required by muse-js — do not upgrade to 7), `fft.js@4`. No UI framework — vanilla DOM + Canvas + SVG.

**Bundle size:** ≈ 160 KB JS, ≈ 41 KB gzipped.

---

## Limitations and honest caveats

- **Only 4 electrodes.** Muse 2 cannot resolve focal cortical activity. The topo clouds are *localized* to the four electrode neighborhoods — frontal pair and two temporal — and the rest of the scalp is rendered transparent because we genuinely have no information there. Read it as left/right and frontal/temporal contrasts, not as a 32-channel head map.
- **TP9 / TP10 are not occipital.** They're temporo-parietal mastoid sites, the closest Muse 2 gives you to "posterior alpha." Real alpha enhancement is strongest at Pz / O1 / O2, which we don't have. Treat temporal alpha as a proxy.
- **Frontal sites near oculomotor sources.** AF7 / AF8 pick up eye-movement and blink artifacts. Frontal-theta readings can be inflated by oculomotor activity. Baseline with eyes closed and still helps.
- **z-scores are vs. your own baseline.** Not a normative population score. Re-baseline if you move the headband or change posture / lighting / state significantly.
- **Web Bluetooth is browser-only.** Chrome / Edge. Safari and Firefox will refuse to connect.
- **One BLE client at a time.** Quit the Muse mobile app first.
- **Bundle is offline-capable** but the Web Bluetooth permission prompt requires a user gesture (the Connect button), so this is not a kiosk-style auto-start app.

---

## Development notes

- **DC tracker** in `ChannelBuffer.push` initializes to the first sample for instant convergence (avoids huge synthetic offsets in the first few seconds of the buffer).
- **Peak amplitude** for diagnostics is computed on the **mean-centered window** so any residual DC bias doesn't poison the quality check.
- **HF ratio** for the EMG diagnostic notches out 48–52 and 58–62 Hz to tolerate mains noise from either EU or US power lines.
- **Hash routing** is read on page load and on `hashchange` — never call `gotoDetail` or `gotoLive` without going through the hash, otherwise back/forward will desync.
- **IDB transactions** for `saveSession` and `renameSession` write to both `meta` and `full` atomically.
- **One-time migration** from the older `seebrain.sessions.v1.*` localStorage schema runs on init.

To add a new derived analysis, the simplest path is:

1. Compute it in `analysis.ts` from a `ZScoreMap`.
2. Surface it in the live meditation panel and the detail view summary.
3. Add a column to the CSV builders in `main.ts` if it should be exportable.
4. No storage migration needed — anything new is computed on the fly from the stored raw + z-scores.

---

## License

MIT — see [LICENSE](LICENSE) if/when added. EEG interpretation guidance in this README references published methodology; you are responsible for evaluating its appropriateness for your use case (research, personal feedback, etc.). This is not a medical device.
