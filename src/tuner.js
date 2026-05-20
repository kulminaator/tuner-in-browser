/**
 * tuner.js — Pure logic for the chromatic tuner.
 * No DOM dependencies; works in Node and in the browser.
 *
 * Pitch detection uses a YIN-inspired algorithm with harmonic consistency
 * checking to avoid octave errors on real instruments.
 */

export const NOTE_STRINGS = [
  'C', 'C#', 'D', 'D#', 'E', 'F',
  'F#', 'G', 'G#', 'A', 'A#', 'B',
];

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_FREQ = 30;        // Hz — lowest note we care about
const MAX_FREQ = 2000;      // Hz — highest note we care about
const YIN_THRESHOLD = 0.14; // CMND dip threshold
const RMS_GATE_YIN = 0.005; // minimum RMS for YIN detection
const RMS_GATE_AC = 0.01;   // minimum RMS for autocorrelation

// ── Utility helpers ──────────────────────────────────────────────────────────

function computeRms(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / buffer.length);
}

// ── YIN-inspired pitch detection ─────────────────────────────────────────────

/**
 * Orchestrates the YIN pipeline:
 *   RMS gate → difference function → CMND → dip search →
 *   parabolic interpolation → harmonic consistency fallback.
 */
export function detectPitch(buffer, sampleRate) {
  const maxLag = Math.floor(sampleRate / MIN_FREQ);
  const minLag = Math.floor(sampleRate / MAX_FREQ);

  if (computeRms(buffer) < RMS_GATE_YIN) return -1;

  const maxTau = Math.min(maxLag, Math.floor(buffer.length / 2));
  const diffFunc = computeDifferenceFunction(buffer, maxTau);
  const cmnd = computeCMND(diffFunc);

  const dipStart = findFirstDipStart(cmnd, minLag, maxTau);
  if (dipStart === -1) return -1;

  const bestTau = findDipMinimum(cmnd, dipStart, maxTau);
  const bestLag = interpolateParabolically(cmnd, bestTau, maxTau);

  const frequency = sampleRate / bestLag;

  if (!isHarmonicallyConsistent(cmnd, bestLag, minLag, maxTau)) {
    return tryHarmonicFallback(cmnd, bestLag, sampleRate, minLag, maxTau);
  }

  return frequency;
}

/**
 * Difference function normalised by (N−τ) to remove the edge-effect bias
 * that would otherwise pull low-frequency estimates sharp.
 */
function computeDifferenceFunction(buffer, maxTau) {
  const d = new Float32Array(maxTau + 1);
  d[0] = 0;
  const SIZE = buffer.length;

  for (let tau = 1; tau <= maxTau; tau++) {
    let diff = 0;
    const terms = SIZE - tau;
    for (let i = 0; i < terms; i++) {
      const delta = buffer[i] - buffer[i + tau];
      diff += delta * delta;
    }
    d[tau] = diff / terms;
  }

  return d;
}

/**
 * Cumulative mean-normalised difference for a reliable threshold.
 */
function computeCMND(diffFunc) {
  const cmnd = new Float32Array(diffFunc.length);
  cmnd[0] = 1;
  let cumSum = 0;

  for (let tau = 1; tau < diffFunc.length; tau++) {
    cumSum += diffFunc[tau];
    cmnd[tau] = diffFunc[tau] * tau / cumSum;
  }

  return cmnd;
}

/**
 * Find the first lag where CMND drops below the threshold.
 */
function findFirstDipStart(cmnd, minLag, maxTau) {
  for (let tau = minLag; tau < maxTau; tau++) {
    if (cmnd[tau] < YIN_THRESHOLD) return tau;
  }
  return -1;
}

/**
 * Scan the dip and return the lag with the deepest minimum.
 */
function findDipMinimum(cmnd, dipStart, maxTau) {
  let bestTau = dipStart;
  let bestVal = cmnd[dipStart];

  for (let tau = dipStart + 1; tau < maxTau; tau++) {
    if (cmnd[tau] >= YIN_THRESHOLD) break;
    if (cmnd[tau] < bestVal) {
      bestVal = cmnd[tau];
      bestTau = tau;
    }
  }

  return bestTau;
}

/**
 * Parabolic interpolation for sub-sample precision (clamped to ±0.5).
 */
function interpolateParabolically(cmnd, bestTau, maxTau) {
  if (bestTau <= 0 || bestTau >= maxTau - 1) return bestTau;

  const x0 = cmnd[bestTau - 1];
  const x1 = cmnd[bestTau];
  const x2 = cmnd[bestTau + 1];
  const denom = x0 - 2 * x1 + x2;

  if (denom === 0) return bestTau;

  const p = 0.5 * (x0 - x2) / denom;
  return bestTau + Math.max(-0.5, Math.min(0.5, p));
}

/**
 * Check whether a candidate fundamental lag has consistent harmonic dips.
 */
function isHarmonicallyConsistent(cmnd, fundLag, minLag, maxLag) {
  const fundIdx = Math.round(fundLag);
  if (fundIdx < 1 || fundIdx >= cmnd.length) return false;
  if (cmnd[fundIdx] > 0.3) return false;

  const h2Idx = Math.round(fundLag * 2);
  if (h2Idx < cmnd.length && h2Idx >= minLag) {
    if (cmnd[h2Idx] > 0.5) return false;
  }

  return true;
}

/**
 * If the primary lag fails harmonic consistency, try 2× and 3× (half and
 * third the frequency) as fallback candidates.
 */
function tryHarmonicFallback(cmnd, bestLag, sampleRate, minLag, maxTau) {
  for (const multiplier of [2, 3]) {
    const lag = bestLag * multiplier;
    if (lag <= maxTau && lag >= minLag) {
      if (isHarmonicallyConsistent(cmnd, lag, minLag, maxTau)) {
        return sampleRate / lag;
      }
    }
  }
  return sampleRate / bestLag;
}

// ── Legacy autocorrelation ───────────────────────────────────────────────────

/**
 * Autocorrelation-based pitch detection (legacy, kept for backward compat).
 */
export function autoCorrelate(buffer, sampleRate) {
  const SIZE = buffer.length;
  const MAX_SAMPLES = Math.floor(SIZE / 2);

  if (computeRms(buffer) < RMS_GATE_AC) return -1;

  let lastCorrelation = 1;
  for (let offset = 1; offset < MAX_SAMPLES; offset++) {
    const correlation = computeCorrelationAt(buffer, offset, MAX_SAMPLES);

    if (correlation > 0.9 && lastCorrelation < 0.9) {
      const { offset: bestOffset, correlation: bestCorr } =
        refineCorrelationPeak(buffer, offset, MAX_SAMPLES);

      if (bestCorr > 0.9) return sampleRate / bestOffset;
    }

    lastCorrelation = correlation;
  }

  return -1;
}

/**
 * Correlation at a single offset: 1 − mean(|buffer[i] − buffer[i+offset]|).
 */
function computeCorrelationAt(buffer, offset, maxSamples) {
  let correlation = 0;
  for (let i = 0; i < maxSamples; i++) {
    correlation += Math.abs(buffer[i] - buffer[i + offset]);
  }
  return 1 - (correlation / maxSamples);
}

/**
 * Scan up to 10 offsets from the initial peak to find the true maximum.
 */
function refineCorrelationPeak(buffer, offset, maxSamples) {
  let peakOffset = offset;
  let peakCorr = computeCorrelationAt(buffer, offset, maxSamples);

  for (let j = offset; j < Math.min(offset + 10, maxSamples); j++) {
    const testCorr = computeCorrelationAt(buffer, j, maxSamples);
    if (testCorr > peakCorr) {
      peakCorr = testCorr;
      peakOffset = j;
    }
  }

  return { offset: peakOffset, correlation: peakCorr };
}

// ── Note mapping ─────────────────────────────────────────────────────────────

/**
 * Convert a frequency (Hz) to the nearest note name, octave, and cents offset.
 */
export function frequencyToNote(frequency) {
  if (frequency <= 0 || !Number.isFinite(frequency)) {
    throw new Error(`Invalid frequency: ${frequency}`);
  }

  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
  const roundedNoteNum = Math.round(noteNum);
  const cents = Math.floor((noteNum - roundedNoteNum) * 100);
  const midiNote = roundedNoteNum + 69;
  const noteIndex = midiNote % 12;
  const octave = Math.floor(midiNote / 12) - 1;

  return {
    note: NOTE_STRINGS[noteIndex < 0 ? noteIndex + 12 : noteIndex],
    octave,
    cents,
    frequency,
  };
}

// ── Pitch smoothing / stability ──────────────────────────────────────────────

/**
 * Smooths raw frequency readings so the display doesn't jump around.
 */
export class PitchSmoothing {
  constructor(windowSize = 8, minAgree = 3) {
    this.windowSize = windowSize;
    this.minAgree = minAgree;
    this.history = [];
    this.currentNote = null;
    this.currentFreq = -1;
    this.currentCents = 0;
    this.agreeCount = 0;
  }

  update(rawFreq) {
    if (rawFreq <= 0) return this._handleSilence();

    this.history.push(frequencyToNote(rawFreq));
    if (this.history.length > this.windowSize) this.history.shift();

    const medianFreq = this._weightedMedian();
    const medianNote = frequencyToNote(medianFreq);
    this._updateAgreement(medianNote);

    return this._buildResult();
  }

  _handleSilence() {
    this.currentNote = null;
    this.currentFreq = -1;
    this.currentCents = 0;
    this.agreeCount = 0;
    this.history = [];
    return null;
  }

  _updateAgreement(medianNote) {
    const noteKey = `${medianNote.note}${medianNote.octave}`;
    const currentKey = this.currentNote
      ? `${this.currentNote.note}${this.currentNote.octave}`
      : null;

    if (noteKey === currentKey) {
      this.agreeCount++;
    } else {
      this.agreeCount = 1;
      this.currentNote = { note: medianNote.note, octave: medianNote.octave };
    }

    this.currentFreq = medianNote.frequency;
    this.currentCents = medianNote.cents;
  }

  _buildResult() {
    return {
      note: this.currentNote.note,
      octave: this.currentNote.octave,
      cents: this.currentCents,
      frequency: this.currentFreq,
      stable: this.agreeCount >= this.minAgree,
    };
  }

  _weightedMedian() {
    if (this.history.length === 0) return -1;

    const sorted = this.history.slice()
      .sort((a, b) => a.frequency - b.frequency);

    const totalWeight =
      this.history.length * (this.history.length + 1) / 2;
    let cumWeight = 0;
    const halfWeight = totalWeight / 2;

    for (let i = 0; i < sorted.length; i++) {
      const origIdx = this.history.indexOf(sorted[i]);
      cumWeight += origIdx + 1;
      if (cumWeight >= halfWeight) {
        return sorted[i].frequency;
      }
    }

    return sorted[sorted.length - 1].frequency;
  }

  reset() {
    this.history = [];
    this.currentNote = null;
    this.currentFreq = -1;
    this.currentCents = 0;
    this.agreeCount = 0;
  }
}

// ── Test helpers ─────────────────────────────────────────────────────────────

export function generateSineBuffer(frequency, sampleRate, length) {
  const buffer = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    buffer[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate);
  }
  return buffer;
}

export function generateSilentBuffer(length) {
  return new Float32Array(length);
}
