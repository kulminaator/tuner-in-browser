/**
 * test-bass-recognition.js — Tests that load real bass-guitar WAV recordings
 * (stereo, 16-bit PCM, 44100 Hz) and run them through the tuner pipeline.
 *
 * Standard 4-string bass tuning:  E1 (41.2 Hz) · A1 (55 Hz) · D2 (73.4 Hz) · G2 (98 Hz)
 *
 * These are real instrument recordings, not pure sine waves, so tolerances are
 * wider than the synthetic-sine tests.
 *
 * Run with:  node tests/test-runner.js tests/test-bass-recognition.js
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  describe,
  it,
  assertEqual,
  assertClose,
  assertTrue,
  assertFalse,
  assertThrows,
  assertHasProps,
  assertGreaterThan,
  assertLessThan,
  assertArrayEqual,
  parseWav,
  run,
} from './test-runner.js';

import {
  detectPitch,
  frequencyToNote,
  NOTE_STRINGS,
} from '../src/tuner.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadWav(filename) {
  const filePath = join(__dirname, 'resources', filename);
  const raw = readFileSync(filePath);
  return parseWav(raw);
}

/**
 * Scan a WAV file chunk-by-chunk and return the most common detected note
 * together with its average frequency and per-chunk detections.
 *
 * @param {string} filename
 * @param {number} chunkSize - samples per chunk (default 16384 for bass)
 * @param {number} step      - step between chunks (default 8192)
 * @returns {{
 *   bestNote: string,
 *   bestOctave: number,
 *   bestFrequency: number,
 *   bestCount: number,
 *   totalSamples: number,
 *   chunksProcessed: number,
 *   detections: { frequency: number, note: string, octave: number, cents: number }[]
 * }}
 */
function tuneWav(filename, chunkSize = 16384, step = 8192) {
  const { samples, sampleRate } = loadWav(filename);

  const noteFreqs = {}; // "Xn" -> [freq, ...]

  for (let offset = 0; offset + chunkSize <= samples.length; offset += step) {
    const chunk = samples.slice(offset, offset + chunkSize);
    const freq = detectPitch(chunk, sampleRate);
    if (freq > 0) {
      const note = frequencyToNote(freq);
      const key = `${note.note}${note.octave}`;
      if (!noteFreqs[key]) noteFreqs[key] = [];
      noteFreqs[key].push(freq);
    }
  }

  // Find the most common note
  let bestNote = null, bestOctave = null, bestCount = 0, bestFreqs = [];
  for (const [key, freqs] of Object.entries(noteFreqs)) {
    if (freqs.length > bestCount) {
      bestCount = freqs.length;
      bestFreqs = freqs;
      const lastChar = key[key.length - 1];
      bestOctave = parseInt(lastChar, 10);
      bestNote = key.slice(0, -1);
    }
  }

  const bestFrequency = bestFreqs.length
    ? bestFreqs.reduce((a, b) => a + b, 0) / bestFreqs.length
    : -1;

  // Build full detections list
  const detections = [];
  for (let offset = 0; offset + chunkSize <= samples.length; offset += step) {
    const chunk = samples.slice(offset, offset + chunkSize);
    const freq = detectPitch(chunk, sampleRate);
    if (freq > 0) {
      const note = frequencyToNote(freq);
      detections.push({ frequency: freq, note: note.note, octave: note.octave, cents: note.cents });
    }
  }

  return {
    bestNote,
    bestOctave,
    bestFrequency,
    bestCount,
    totalSamples: samples.length,
    chunksProcessed: detections.length,
    detections,
    sampleRate,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// parseWav — stereo bass files
// ──────────────────────────────────────────────────────────────────────────────

describe('parseWav — stereo bass files', () => {
  for (const file of ['bass_string1.wav', 'bass_string2.wav', 'bass_string3.wav', 'bass_string4.wav']) {
    it(`${file} — parses correctly (stereo, 44100 Hz, 16-bit)`, () => {
      const wav = loadWav(file);
      assertEqual(wav.sampleRate, 44100);
      assertEqual(wav.channels, 2, `${file} should be stereo`);
      assertGreaterThan(wav.samples.length, 100000, `${file} should have many samples`);
    });

    it(`${file} — sample values stay in [-1, 1]`, () => {
      const wav = loadWav(file);
      for (let i = 0; i < wav.samples.length; i++) {
        assertTrue(
          wav.samples[i] >= -1.0001 && wav.samples[i] <= 1.0001,
          `${file} sample ${i} out of range: ${wav.samples[i]}`
        );
      }
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Pure-tone ground-truth references
// ──────────────────────────────────────────────────────────────────────────────

describe('Pure-tone references — ground truth', () => {
  const refs = [
    { file: 'a4_440hz.wav', note: 'A', octave: 4, freq: 440, tol: 0.5 },
    { file: 'e4_329.63hz.wav', note: 'E', octave: 4, freq: 329.63, tol: 0.5 },
    { file: 'e1_41.2hz.wav', note: 'E', octave: 1, freq: 41.2, tol: 1 },
  ];

  for (const r of refs) {
    it(`${r.file} → ${r.note}${r.octave} at ${r.freq} Hz`, () => {
      const result = tuneWav(r.file);
      assertEqual(result.bestNote, r.note);
      assertEqual(result.bestOctave, r.octave);
      assertClose(result.bestFrequency, r.freq, r.tol, `${r.file} should be ~${r.freq} Hz`);
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// bass_string1.wav — E1 (≈ 41.2 Hz)
// ──────────────────────────────────────────────────────────────────────────────

describe('bass_string1.wav — E1', () => {
  let result;

  it('loads and produces detections', () => {
    result = tuneWav('bass_string1.wav');
    assertGreaterThan(result.chunksProcessed, 10, 'should detect in many chunks');
  });

  it('most common note is E1', () => {
    if (!result) result = tuneWav('bass_string1.wav');
    assertEqual(result.bestNote, 'E');
    assertEqual(result.bestOctave, 1);
  });

  it('average frequency is close to 41.2 Hz (E1)', () => {
    if (!result) result = tuneWav('bass_string1.wav');
    assertClose(result.bestFrequency, 41.2, 1.5);
  });

  it('detection rate is above 50 %', () => {
    if (!result) result = tuneWav('bass_string1.wav');
    const totalChunks = Math.floor(result.totalSamples / 16384) - 1;
    assertTrue(
      result.chunksProcessed >= totalChunks * 0.5,
      `at least 50 % of chunks should detect (got ${result.chunksProcessed}/${totalChunks})`
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// bass_string2.wav — A1 (≈ 55 Hz)
// ──────────────────────────────────────────────────────────────────────────────

describe('bass_string2.wav — A1', () => {
  let result;

  it('loads and produces detections', () => {
    result = tuneWav('bass_string2.wav');
    assertGreaterThan(result.chunksProcessed, 10);
  });

  it('most common note is A1', () => {
    if (!result) result = tuneWav('bass_string2.wav');
    assertEqual(result.bestNote, 'A');
    assertEqual(result.bestOctave, 1);
  });

  it('average frequency is close to 55 Hz (A1)', () => {
    if (!result) result = tuneWav('bass_string2.wav');
    assertClose(result.bestFrequency, 55, 2);
  });

  it('detection rate is above 40 %', () => {
    if (!result) result = tuneWav('bass_string2.wav');
    const totalChunks = Math.floor(result.totalSamples / 16384) - 1;
    assertTrue(
      result.chunksProcessed >= totalChunks * 0.4,
      `at least 40 % of chunks should detect (got ${result.chunksProcessed}/${totalChunks})`
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// bass_string3.wav — D2 (≈ 73.4 Hz)
// ──────────────────────────────────────────────────────────────────────────────

describe('bass_string3.wav — D2', () => {
  let result;

  it('loads and produces detections', () => {
    result = tuneWav('bass_string3.wav');
    assertGreaterThan(result.chunksProcessed, 10);
  });

  it('most common note is D2', () => {
    if (!result) result = tuneWav('bass_string3.wav');
    assertEqual(result.bestNote, 'D');
    assertEqual(result.bestOctave, 2);
  });

  it('average frequency is close to 73.4 Hz (D2)', () => {
    if (!result) result = tuneWav('bass_string3.wav');
    assertClose(result.bestFrequency, 73.4, 2);
  });

  it('detection rate is above 50 %', () => {
    if (!result) result = tuneWav('bass_string3.wav');
    const totalChunks = Math.floor(result.totalSamples / 16384) - 1;
    assertTrue(
      result.chunksProcessed >= totalChunks * 0.5,
      `at least 50 % of chunks should detect (got ${result.chunksProcessed}/${totalChunks})`
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// bass_string4.wav — G2 (≈ 98 Hz)
// ──────────────────────────────────────────────────────────────────────────────

describe('bass_string4.wav — G2', () => {
  let result;

  it('loads and produces detections', () => {
    result = tuneWav('bass_string4.wav');
    assertGreaterThan(result.chunksProcessed, 10);
  });

  it('most common note is G2', () => {
    if (!result) result = tuneWav('bass_string4.wav');
    assertEqual(result.bestNote, 'G');
    assertEqual(result.bestOctave, 2);
  });

  it('average frequency is close to 98 Hz (G2)', () => {
    if (!result) result = tuneWav('bass_string4.wav');
    assertClose(result.bestFrequency, 98, 2);
  });

  it('detection rate is above 50 %', () => {
    if (!result) result = tuneWav('bass_string4.wav');
    const totalChunks = Math.floor(result.totalSamples / 16384) - 1;
    assertTrue(
      result.chunksProcessed >= totalChunks * 0.5,
      `at least 50 % of chunks should detect (got ${result.chunksProcessed}/${totalChunks})`
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Cross-file: all four bass strings
// ──────────────────────────────────────────────────────────────────────────────

describe('Cross-file — bass strings', () => {
  const files = [
    'bass_string1.wav',
    'bass_string2.wav',
    'bass_string3.wav',
    'bass_string4.wav',
  ];

  it('each file produces a valid best frequency', () => {
    const freqs = files.map((f) => tuneWav(f).bestFrequency);
    for (const freq of freqs) {
      assertGreaterThan(freq, 0, 'every string should detect a frequency');
    }
  });

  it('frequencies are strictly ascending (E1 < A1 < D2 < G2)', () => {
    const freqs = files.map((f) => tuneWav(f).bestFrequency);
    for (let i = 1; i < freqs.length; i++) {
      assertGreaterThan(
        freqs[i],
        freqs[i - 1],
        `${files[i]} (${freqs[i].toFixed(1)} Hz) should be higher than ${files[i - 1]} (${freqs[i - 1].toFixed(1)} Hz)`
      );
    }
  });

  it('all four best notes are different', () => {
    const notes = files.map((f) => {
      const r = tuneWav(f);
      return `${r.bestNote}${r.bestOctave}`;
    });
    assertEqual(new Set(notes).size, 4, `notes should be unique: ${notes.join(', ')}`);
  });

  it('notes are E1, A1, D2, G2 (standard bass tuning)', () => {
    const notes = files.map((f) => {
      const r = tuneWav(f);
      return `${r.bestNote}${r.bestOctave}`;
    });
    assertArrayEqual(notes, ['E1', 'A1', 'D2', 'G2']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Single-chunk detection on the loudest region of each file
// ──────────────────────────────────────────────────────────────────────────────

describe('Single-chunk detection on loudest region', () => {
  for (const file of ['bass_string1.wav', 'bass_string2.wav', 'bass_string3.wav', 'bass_string4.wav']) {
    it(`${file} — loudest 16384-sample chunk yields a valid frequency`, () => {
      const { samples, sampleRate } = loadWav(file);
      const chunkSize = 16384;

      // Find the chunk with the highest RMS
      let bestRms = 0, bestOffset = 0;
      for (let start = 0; start + chunkSize <= samples.length; start += 4096) {
        const chunk = samples.slice(start, start + chunkSize);
        let rms = 0;
        for (let i = 0; i < chunk.length; i++) rms += chunk[i] * chunk[i];
        rms = Math.sqrt(rms / chunk.length);
        if (rms > bestRms) {
          bestRms = rms;
          bestOffset = start;
        }
      }

      const chunk = samples.slice(bestOffset, bestOffset + chunkSize);
      const freq = detectPitch(chunk, sampleRate);
      assertGreaterThan(freq, 0, `${file} should detect a frequency in its loudest chunk`);

      const note = frequencyToNote(freq);
      assertTrue(NOTE_STRINGS.includes(note.note), `${file} note should be a valid note name`);
    });
  }
});

// ── Run ──────────────────────────────────────────────────────────────────────
run();
