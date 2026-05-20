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

// ── YIN-inspired pitch detection ─────────────────────────────────────────────

const MIN_FREQ = 30;       // Hz — lowest note we care about
const MAX_FREQ = 2000;     // Hz — highest note we care about

/**
 * YIN-inspired pitch detection, robust against harmonics and noise.
 *
 * Steps:
 *  1. Compute the difference function, normalised by (N−τ) to remove the
 *     edge-effect bias that would otherwise pull low-frequency estimates
 *     sharp.
 *  2. Cumulative mean-normalised difference (CMND) for a reliable threshold.
 *  3. Find the true minimum inside the first dip below threshold.
 *  4. Parabolic interpolation for sub-sample precision.
 *  5. Harmonic consistency check: verify the fundamental's harmonics are
 *     present so we don't confuse a harmonic for the fundamental.
 *
 * @param {Float32Array|number[]} buffer - Audio samples in [-1, 1]
 * @param {number} sampleRate - Samples per second
 * @returns {number} Detected frequency in Hz, or -1 if no signal
 */
export function detectPitch(buffer, sampleRate) {
  const SIZE = buffer.length;
  const MAX_LAG = Math.floor(sampleRate / MIN_FREQ);
  const MIN_LAG = Math.floor(sampleRate / MAX_FREQ);

  // --- RMS gate ---
  let rms = 0;
  for (let i = 0; i < SIZE; i++) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.005) return -1;

  // --- Difference function (normalised by N−τ) ---
  // Without this normalisation the raw sum naturally decreases at larger τ
  // simply because fewer pairs are summed, creating a downward slope that
  // biases the detected lag short (frequency sharp) — especially at low
  // frequencies where τ is large.
  const maxTau = Math.min(MAX_LAG, Math.floor(SIZE / 2));
  const d = new Float32Array(maxTau + 1);
  d[0] = 0;

  for (let tau = 1; tau <= maxTau; tau++) {
    let diff = 0;
    const terms = SIZE - tau;
    for (let i = 0; i < terms; i++) {
      const delta = buffer[i] - buffer[i + tau];
      diff += delta * delta;
    }
    d[tau] = diff / terms;  // ← key fix: normalise by number of terms
  }

  // --- Cumulative mean-normalised difference (CMND) ---
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let cumSum = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    cumSum += d[tau];
    cmnd[tau] = d[tau] * tau / cumSum;
  }

  // --- Find the true minimum inside the first dip below threshold ---
  const THRESHOLD = 0.14;
  let dipStart = -1;
  for (let tau = MIN_LAG; tau < maxTau; tau++) {
    if (cmnd[tau] < THRESHOLD) {
      dipStart = tau;
      break;
    }
  }

  if (dipStart === -1) return -1;

  // Scan the whole dip and track the actual minimum
  let bestTau = dipStart;
  let bestVal = cmnd[dipStart];
  for (let tau = dipStart + 1; tau < maxTau; tau++) {
    if (cmnd[tau] >= THRESHOLD) break;  // exited the dip
    if (cmnd[tau] < bestVal) {
      bestVal = cmnd[tau];
      bestTau = tau;
    }
  }

  // --- Parabolic interpolation for sub-sample precision ---
  let bestLag = bestTau;
  if (bestTau > 0 && bestTau < maxTau - 1) {
    const x0 = cmnd[bestTau - 1];
    const x1 = cmnd[bestTau];
    const x2 = cmnd[bestTau + 1];
    const denom = x0 - 2 * x1 + x2;
    if (denom !== 0) {
      const p = 0.5 * (x0 - x2) / denom;
      // Clamp to ±0.5 so we don't overshoot to a neighbouring period
      bestLag = bestTau + Math.max(-0.5, Math.min(0.5, p));
    }
  }

  const frequency = sampleRate / bestLag;

  // --- Harmonic consistency check ---
  if (!isHarmonicallyConsistent(cmnd, bestLag, MIN_LAG, maxTau)) {
    const halfFreqLag = bestLag * 2;
    if (halfFreqLag <= maxTau && halfFreqLag >= MIN_LAG) {
      if (isHarmonicallyConsistent(cmnd, halfFreqLag, MIN_LAG, maxTau)) {
        return sampleRate / halfFreqLag;
      }
    }
    const thirdFreqLag = bestLag * 3;
    if (thirdFreqLag <= maxTau && thirdFreqLag >= MIN_LAG) {
      if (isHarmonicallyConsistent(cmnd, thirdFreqLag, MIN_LAG, maxTau)) {
        return sampleRate / thirdFreqLag;
      }
    }
  }

  return frequency;
}

/**
 * Check whether a candidate fundamental lag has consistent harmonic dips.
 * @param {Float32Array} cmnd
 * @param {number} fundLag - candidate fundamental lag (float)
 * @param {number} minLag
 * @param {number} maxLag
 * @returns {boolean}
 */
function isHarmonicallyConsistent(cmnd, fundLag, minLag, maxLag) {
  const fundIdx = Math.round(fundLag);
  if (fundIdx < 1 || fundIdx >= cmnd.length) return false;
  if (cmnd[fundIdx] > 0.3) return false; // fundamental dip must be significant

  // Check 2nd harmonic
  const h2Idx = Math.round(fundLag * 2);
  if (h2Idx < cmnd.length && h2Idx >= minLag) {
    // The 2nd harmonic should also show a dip (not necessarily as deep)
    if (cmnd[h2Idx] > 0.5) return false;
  }

  return true;
}

// Keep the old name as an alias so existing tests still compile,
// but the old autoCorrelate is still exported for backward compat.

/**
 * Autocorrelation-based pitch detection (legacy, kept for backward compatibility).
 * @param {Float32Array|number[]} buffer - Audio samples in [-1, 1]
 * @param {number} sampleRate - Samples per second
 * @returns {number} Detected frequency in Hz, or -1 if no signal
 */
export function autoCorrelate(buffer, sampleRate) {
  const SIZE = buffer.length;
  const MAX_SAMPLES = Math.floor(SIZE / 2);
  let best_offset = -1;
  let best_correlation = 0;
  let rms = 0;

  for (let i = 0; i < SIZE; i++) {
    const val = buffer[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;

  let lastCorrelation = 1;
  for (let offset = 1; offset < MAX_SAMPLES; offset++) {
    let correlation = 0;
    for (let i = 0; i < MAX_SAMPLES; i++) {
      correlation += Math.abs(buffer[i] - buffer[i + offset]);
    }
    correlation = 1 - (correlation / MAX_SAMPLES);

    if (correlation > 0.9) {
      if (lastCorrelation < 0.9) {
        let peak_offset = offset;
        let peak_correlation = correlation;
        for (let j = offset; j < Math.min(offset + 10, MAX_SAMPLES); j++) {
          let test_correlation = 0;
          for (let i = 0; i < MAX_SAMPLES; i++) {
            test_correlation += Math.abs(buffer[i] - buffer[i + j]);
          }
          test_correlation = 1 - (test_correlation / MAX_SAMPLES);
          if (test_correlation > peak_correlation) {
            peak_correlation = test_correlation;
            peak_offset = j;
          }
        }
        best_offset = peak_offset;
        best_correlation = peak_correlation;
        break;
      }
    }
    lastCorrelation = correlation;
  }

  if (best_offset !== -1 && best_correlation > 0.9) {
    return sampleRate / best_offset;
  }
  return -1;
}

// ── Note mapping ─────────────────────────────────────────────────────────────

/**
 * Convert a frequency (Hz) to the nearest note name, octave, and cents offset.
 * @param {number} frequency - Frequency in Hz
 * @returns {{ note: string, octave: number, cents: number, frequency: number }}
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
    octave: octave,
    cents: cents,
    frequency: frequency,
  };
}

// ── Pitch smoothing / stability ──────────────────────────────────────────────

/**
 * Smooths raw frequency readings so the display doesn't jump around.
 *
 * Strategy:
 *  - Keep a ring buffer of the last N raw detections.
 *  - Compute the weighted median (recent readings count more).
 *  - Only emit a new "stable" note when the median note has been the
 *    same for at least `minAgree` consecutive samples.
 *  - If the note changes, require confirmation before switching.
 */
export class PitchSmoothing {
  /**
   * @param {number} windowSize - Number of raw samples to keep (default 8)
   * @param {number} minAgree   - Consecutive same-note samples required to switch (default 3)
   */
  constructor(windowSize = 8, minAgree = 3) {
    this.windowSize = windowSize;
    this.minAgree = minAgree;
    this.history = [];          // { freq, note, octave, cents }
    this.currentNote = null;    // { note, octave }
    this.currentFreq = -1;
    this.currentCents = 0;
    this.agreeCount = 0;
  }

  /**
   * Feed a new raw frequency detection.
   * @param {number} rawFreq - Detected frequency in Hz, or -1 for silence
   * @returns {{ note: string, octave: number, cents: number, frequency: number, stable: boolean } | null}
   */
  update(rawFreq) {
    if (rawFreq <= 0) {
      // Silence — reset
      this.currentNote = null;
      this.currentFreq = -1;
      this.currentCents = 0;
      this.agreeCount = 0;
      this.history = [];
      return null;
    }

    const noteInfo = frequencyToNote(rawFreq);
    this.history.push(noteInfo);
    if (this.history.length > this.windowSize) {
      this.history.shift();
    }

    // Compute median frequency from the window (weighted toward recent)
    const medianFreq = this._weightedMedian();
    const medianNote = frequencyToNote(medianFreq);
    const noteKey = `${medianNote.note}${medianNote.octave}`;
    const currentKey = this.currentNote
      ? `${this.currentNote.note}${this.currentNote.octave}`
      : null;

    if (noteKey === currentKey) {
      // Same note — confirm
      this.agreeCount++;
      this.currentFreq = medianFreq;
      this.currentCents = medianNote.cents;
    } else {
      // Different note — need confirmation
      this.agreeCount = 1;
      // Tentatively update so we start counting agreement
      this.currentNote = { note: medianNote.note, octave: medianNote.octave };
      this.currentFreq = medianFreq;
      this.currentCents = medianNote.cents;
    }

    const stable = this.agreeCount >= this.minAgree;

    return {
      note: this.currentNote.note,
      octave: this.currentNote.octave,
      cents: this.currentCents,
      frequency: this.currentFreq,
      stable,
    };
  }

  /**
   * Weighted median: sort by frequency, give more weight to recent entries.
   */
  _weightedMedian() {
    if (this.history.length === 0) return -1;

    // Sort copies by frequency
    const sorted = this.history.slice().sort((a, b) => a.frequency - b.frequency);

    // Assign weights: position in history (more recent = higher weight)
    const totalWeight = this.history.length * (this.history.length + 1) / 2;
    let cumWeight = 0;
    const halfWeight = totalWeight / 2;

    for (let i = 0; i < sorted.length; i++) {
      // Find the original index of this entry to get its recency weight
      const origIdx = this.history.indexOf(sorted[i]);
      const weight = origIdx + 1; // 1-based: most recent = highest
      cumWeight += weight;
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

/**
 * Build a synthetic sine-wave buffer for testing.
 */
export function generateSineBuffer(frequency, sampleRate, length) {
  const buffer = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    buffer[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate);
  }
  return buffer;
}

/**
 * Build a silent buffer for testing.
 */
export function generateSilentBuffer(length) {
  return new Float32Array(length);
}
