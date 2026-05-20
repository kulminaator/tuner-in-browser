/**
 * test-audio-recognition.js — Tests that load real WAV files and run them
 * through the tuner's autocorrelation pitch detector.
 *
 * Run with:  node tests/test-runner.js tests/test-audio-recognition.js
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
  autoCorrelate,
  frequencyToNote,
} from '../src/tuner.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadWav(filename) {
  const filePath = join(__dirname, 'resources', filename);
  const raw = readFileSync(filePath);
  return parseWav(raw);
}

/**
 * Feed a WAV's samples through the tuner in chunks the same size as the
 * real-time analyser (4096 samples) and return the best (most common)
 * detected frequency.
 * @param {string} filename
 * @param {number} chunkSize - samples per chunk (default 4096)
 * @returns {{ bestFrequency: number, bestNote: string, bestOctave: number,
 *            totalSamples: number, chunksProcessed: number,
 *            detections: { frequency: number, note: string, octave: number }[] }}
 */
function tuneWav(filename, chunkSize = 4096) {
  const { samples, sampleRate } = loadWav(filename);

  const detections = [];

  for (let offset = 0; offset + chunkSize <= samples.length; offset += chunkSize) {
    const chunk = samples.slice(offset, offset + chunkSize);
    const freq = autoCorrelate(chunk, sampleRate);
    if (freq > 0) {
      const note = frequencyToNote(freq);
      detections.push({ frequency: freq, note: note.note, octave: note.octave, cents: note.cents });
    }
  }

  // Find the most common note (mode)
  const noteCounts = {};
  for (const d of detections) {
    const key = `${d.note}${d.octave}`;
    noteCounts[key] = (noteCounts[key] || 0) + 1;
  }

  let bestNote = null;
  let bestCount = 0;
  for (const [key, count] of Object.entries(noteCounts)) {
    if (count > bestCount) {
      bestCount = count;
      bestNote = key;
    }
  }

  // Average frequency for the best note
  let sumFreq = 0;
  let countFreq = 0;
  const [bestNoteName, bestOctave] = bestNote ? [bestNote.slice(0, -1), parseInt(bestNote.slice(-1))] : [null, null];
  for (const d of detections) {
    if (d.note === bestNoteName && d.octave === bestOctave) {
      sumFreq += d.frequency;
      countFreq++;
    }
  }
  const bestFrequency = countFreq > 0 ? sumFreq / countFreq : -1;

  return {
    bestFrequency,
    bestNote: bestNoteName,
    bestOctave,
    totalSamples: samples.length,
    chunksProcessed: detections.length,
    detections,
    sampleRate,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// parseWav
// ──────────────────────────────────────────────────────────────────────────────

describe('parseWav', () => {
  it('parses a4_440hz.wav and returns correct metadata', () => {
    const wav = loadWav('a4_440hz.wav');
    assertEqual(wav.sampleRate, 44100);
    assertEqual(wav.channels, 1);
    assertGreaterThan(wav.samples.length, 100000, 'should have many samples');
  });

  it('parses e4_329.63hz.wav and returns correct metadata', () => {
    const wav = loadWav('e4_329.63hz.wav');
    assertEqual(wav.sampleRate, 44100);
    assertEqual(wav.channels, 1);
    assertGreaterThan(wav.samples.length, 80000);
  });

  it('parses e1_41.2hz.wav and returns correct metadata', () => {
    const wav = loadWav('e1_41.2hz.wav');
    assertEqual(wav.sampleRate, 44100);
    assertEqual(wav.channels, 1);
    assertGreaterThan(wav.samples.length, 80000);
  });

  it('sample values are in [-1, 1] range', () => {
    for (const file of ['a4_440hz.wav', 'e4_329.63hz.wav', 'e1_41.2hz.wav']) {
      const wav = loadWav(file);
      for (let i = 0; i < wav.samples.length; i++) {
        assertTrue(
          wav.samples[i] >= -1.0001 && wav.samples[i] <= 1.0001,
          `${file} sample ${i} out of range: ${wav.samples[i]}`
        );
      }
    }
  });

  it('throws on non-WAV data', () => {
    assertThrows(() => parseWav(Buffer.from('not a wav file at all')), 'should throw on invalid data');
  });

  it('throws on empty buffer', () => {
    assertThrows(() => parseWav(Buffer.alloc(0)), 'should throw on empty buffer');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Single-chunk detection (first 4096 samples)
// ──────────────────────────────────────────────────────────────────────────────

describe('Single-chunk detection (first 4096 samples)', () => {
  it('a4_440hz.wav → detects ~440 Hz', () => {
    const { samples, sampleRate } = loadWav('a4_440hz.wav');
    const chunk = samples.slice(0, 4096);
    const freq = autoCorrelate(chunk, sampleRate);
    assertGreaterThan(freq, 0, 'should detect a frequency');
    assertClose(freq, 440, 3, 'A4 should be ~440 Hz');
  });

  it('e4_329.63hz.wav → detects ~329.63 Hz', () => {
    const { samples, sampleRate } = loadWav('e4_329.63hz.wav');
    const chunk = samples.slice(0, 4096);
    const freq = autoCorrelate(chunk, sampleRate);
    assertGreaterThan(freq, 0, 'should detect a frequency');
    assertClose(freq, 329.63, 3, 'E4 should be ~329.63 Hz');
  });

  it('e1_41.2hz.wav → detects ~41.2 Hz', () => {
    const { samples, sampleRate } = loadWav('e1_41.2hz.wav');
    // Low frequency needs more samples per cycle; use 8192
    const chunk = samples.slice(0, 8192);
    const freq = autoCorrelate(chunk, sampleRate);
    assertGreaterThan(freq, 0, 'should detect a frequency');
    assertClose(freq, 41.2, 5, 'E1 should be ~41.2 Hz');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Full-file tuning (chunk-by-chunk, majority vote)
// ──────────────────────────────────────────────────────────────────────────────

describe('Full-file tuning — a4_440hz.wav', () => {
  let result;

  it('loads and processes the file', () => {
    result = tuneWav('a4_440hz.wav');
    assertGreaterThan(result.chunksProcessed, 1, 'should process multiple chunks');
    assertGreaterThan(result.detections.length, 1, 'should have detections');
  });

  it('best note is A', () => {
    if (!result) result = tuneWav('a4_440hz.wav');
    assertEqual(result.bestNote, 'A');
  });

  it('best octave is 4', () => {
    if (!result) result = tuneWav('a4_440hz.wav');
    assertEqual(result.bestOctave, 4);
  });

  it('best frequency is close to 440 Hz', () => {
    if (!result) result = tuneWav('a4_440hz.wav');
    assertClose(result.bestFrequency, 440, 3);
  });

  it('most chunks detect a valid frequency', () => {
    if (!result) result = tuneWav('a4_440hz.wav');
    const totalChunks = Math.floor(result.totalSamples / 4096);
    assertTrue(
      result.chunksProcessed >= totalChunks * 0.8,
      `at least 80% of chunks should detect (got ${result.chunksProcessed}/${totalChunks})`
    );
  });
});

describe('Full-file tuning — e4_329.63hz.wav', () => {
  let result;

  it('loads and processes the file', () => {
    result = tuneWav('e4_329.63hz.wav');
    assertGreaterThan(result.chunksProcessed, 1);
  });

  it('best note is E', () => {
    if (!result) result = tuneWav('e4_329.63hz.wav');
    assertEqual(result.bestNote, 'E');
  });

  it('best octave is 4', () => {
    if (!result) result = tuneWav('e4_329.63hz.wav');
    assertEqual(result.bestOctave, 4);
  });

  it('best frequency is close to 329.63 Hz', () => {
    if (!result) result = tuneWav('e4_329.63hz.wav');
    assertClose(result.bestFrequency, 329.63, 3);
  });

  it('most chunks detect a valid frequency', () => {
    if (!result) result = tuneWav('e4_329.63hz.wav');
    const totalChunks = Math.floor(result.totalSamples / 4096);
    assertTrue(
      result.chunksProcessed >= totalChunks * 0.8,
      `at least 80% of chunks should detect (got ${result.chunksProcessed}/${totalChunks})`
    );
  });
});

describe('Full-file tuning — e1_41.2hz.wav', () => {
  let result;

  it('loads and processes the file with larger chunks', () => {
    result = tuneWav('e1_41.2hz.wav', 8192);
    assertGreaterThan(result.chunksProcessed, 1);
  });

  it('best note is E', () => {
    if (!result) result = tuneWav('e1_41.2hz.wav', 8192);
    assertEqual(result.bestNote, 'E');
  });

  it('best octave is 1', () => {
    if (!result) result = tuneWav('e1_41.2hz.wav', 8192);
    assertEqual(result.bestOctave, 1);
  });

  it('best frequency is close to 41.2 Hz', () => {
    if (!result) result = tuneWav('e1_41.2hz.wav', 8192);
    assertClose(result.bestFrequency, 41.2, 5);
  });

  it('most chunks detect a valid frequency', () => {
    if (!result) result = tuneWav('e1_41.2hz.wav', 8192);
    const totalChunks = Math.floor(result.totalSamples / 8192);
    assertTrue(
      result.chunksProcessed >= totalChunks * 0.5,
      `at least 50% of chunks should detect (got ${result.chunksProcessed}/${totalChunks})`
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Cross-file: all three files produce the correct note
// ──────────────────────────────────────────────────────────────────────────────

describe('Cross-file note recognition', () => {
  const files = [
    { name: 'a4_440hz.wav', expectedNote: 'A', expectedOctave: 4, expectedFreq: 440, freqTolerance: 3 },
    { name: 'e4_329.63hz.wav', expectedNote: 'E', expectedOctave: 4, expectedFreq: 329.63, freqTolerance: 3 },
    { name: 'e1_41.2hz.wav', expectedNote: 'E', expectedOctave: 1, expectedFreq: 41.2, freqTolerance: 5 },
  ];

  for (const f of files) {
    it(`${f.name} → note ${f.expectedNote}${f.expectedOctave}`, () => {
      const chunkSize = f.expectedFreq < 60 ? 8192 : 4096;
      const result = tuneWav(f.name, chunkSize);
      assertEqual(result.bestNote, f.expectedNote, `${f.name} should detect ${f.expectedNote}`);
      assertEqual(result.bestOctave, f.expectedOctave, `${f.name} should detect octave ${f.expectedOctave}`);
    });

    it(`${f.name} → frequency ~${f.expectedFreq} Hz`, () => {
      const chunkSize = f.expectedFreq < 60 ? 8192 : 4096;
      const result = tuneWav(f.name, chunkSize);
      assertClose(result.bestFrequency, f.expectedFreq, f.freqTolerance, `${f.name} should be ~${f.expectedFreq} Hz`);
    });
  }
});

// ── Run ──────────────────────────────────────────────────────────────────────
run();
