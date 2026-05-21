/**
 * test-tuner.js — Tests for src/tuner.js
 *
 * Run with:  node tests/test-runner.js tests/test-tuner.js
 */

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
  run,
} from './test-runner.js';

import {
  NOTE_STRINGS,
  autoCorrelate,
  detectPitch,
  frequencyToNote,
  PitchSmoothing,
  generateSineBuffer,
  generateSilentBuffer,
} from '../src/tuner.js';

// ──────────────────────────────────────────────────────────────────────────────
// NOTE_STRINGS
// ──────────────────────────────────────────────────────────────────────────────

describe('NOTE_STRINGS', () => {
  it('has 12 entries', () => {
    assertEqual(NOTE_STRINGS.length, 12);
  });

  it('contains all chromatic notes in order', () => {
    assertArrayEqual(
      NOTE_STRINGS,
      ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    );
  });

  it('has no duplicates', () => {
    assertEqual(new Set(NOTE_STRINGS).size, 12);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// frequencyToNote — exact reference pitches
// ──────────────────────────────────────────────────────────────────────────────

describe('frequencyToNote — reference pitches', () => {
  it('A4 (440 Hz) is A4 with 0 cents', () => {
    const r = frequencyToNote(440);
    assertEqual(r.note, 'A');
    assertEqual(r.octave, 4);
    assertEqual(r.cents, 0);
    assertEqual(r.frequency, 440);
  });

  it('C4 (middle C) is C4 with ~0 cents', () => {
    const exactC4 = 440 * Math.pow(2, -9 / 12);
    const r = frequencyToNote(exactC4);
    assertEqual(r.note, 'C');
    assertEqual(r.octave, 4);
    assertClose(r.cents, 0, 1.5, 'floating-point Math.floor can give -1');
  });

  it('C3 (≈ 130.81 Hz) is C3 with 0 cents', () => {
    const r = frequencyToNote(130.812783);
    assertEqual(r.note, 'C');
    assertEqual(r.octave, 3);
    assertEqual(r.cents, 0);
  });

  it('G4 (≈ 392 Hz) is G4 with 0 cents', () => {
    const r = frequencyToNote(391.995436);
    assertEqual(r.note, 'G');
    assertEqual(r.octave, 4);
    assertEqual(r.cents, 0);
  });

  it('E5 (≈ 659.25 Hz) is E5 with 0 cents', () => {
    const r = frequencyToNote(659.255114);
    assertEqual(r.note, 'E');
    assertEqual(r.octave, 5);
    assertEqual(r.cents, 0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// frequencyToNote — cents offset (sharp / flat)
// ──────────────────────────────────────────────────────────────────────────────

describe('frequencyToNote — cents offset', () => {
  it('slightly sharp A4 shows positive cents', () => {
    const sharpFreq = 440 * Math.pow(2, 5 / 1200);
    const r = frequencyToNote(sharpFreq);
    assertEqual(r.note, 'A');
    assertEqual(r.octave, 4);
    assertGreaterThan(r.cents, 0, 'should be sharp');
    assertLessThan(r.cents, 10, 'should be less than 10 cents');
  });

  it('slightly flat A4 shows negative cents', () => {
    const flatFreq = 440 * Math.pow(2, -5 / 1200);
    const r = frequencyToNote(flatFreq);
    assertEqual(r.note, 'A');
    assertEqual(r.octave, 4);
    assertLessThan(r.cents, 0, 'should be flat');
    assertTrue(r.cents >= -10, 'should be greater than -10 cents');
  });

  it('cents range is between -50 and 49', () => {
    for (let freq = 50; freq < 5000; freq += 3) {
      const r = frequencyToNote(freq);
      assertLessThan(r.cents, 50, `cents should be < 50 at ${freq} Hz`);
      assertTrue(
        r.cents >= -50,
        `cents should be >= -50 at ${freq} Hz (got ${r.cents})`
      );
    }
  });

  it('returns integer cents value', () => {
    const r = frequencyToNote(442);
    assertEqual(Math.floor(r.cents), r.cents, 'cents should be an integer');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// frequencyToNote — edge cases
// ──────────────────────────────────────────────────────────────────────────────

describe('frequencyToNote — edge cases', () => {
  it('throws on zero frequency', () => {
    assertThrows(() => frequencyToNote(0), 'frequency 0 should throw');
  });

  it('throws on negative frequency', () => {
    assertThrows(() => frequencyToNote(-100), 'negative frequency should throw');
  });

  it('throws on NaN frequency', () => {
    assertThrows(() => frequencyToNote(NaN), 'NaN frequency should throw');
  });

  it('handles very low frequency (20 Hz) gracefully', () => {
    const r = frequencyToNote(20);
    assertHasProps(r, ['note', 'octave', 'cents', 'frequency']);
    assertTrue(r.note.length > 0);
  });

  it('handles very high frequency (4000 Hz) gracefully', () => {
    const r = frequencyToNote(4000);
    assertHasProps(r, ['note', 'octave', 'cents', 'frequency']);
    assertTrue(r.note.length > 0);
    assertGreaterThan(r.octave, 5);
  });

  it('returns all 12 note names across a chromatic scale', () => {
    const notes = [];
    for (let i = 0; i < 12; i++) {
      const freq = 261.625565 * Math.pow(2, i / 12);
      notes.push(frequencyToNote(freq).note);
    }
    assertArrayEqual(notes, NOTE_STRINGS);
  });

  it('octave increments correctly over two octaves', () => {
    const octaves = [];
    for (let i = 0; i < 24; i++) {
      const freq = 261.625565 * Math.pow(2, i / 12);
      octaves.push(frequencyToNote(freq).octave);
    }
    for (let i = 0; i < 12; i++) assertEqual(octaves[i], 4);
    for (let i = 12; i < 24; i++) assertEqual(octaves[i], 5);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// frequencyToNote — return value shape
// ──────────────────────────────────────────────────────────────────────────────

describe('frequencyToNote — return shape', () => {
  it('returns an object with note, octave, cents, frequency', () => {
    const r = frequencyToNote(440);
    assertHasProps(r, ['note', 'octave', 'cents', 'frequency']);
  });

  it('note is a string matching NOTE_STRINGS', () => {
    const r = frequencyToNote(440);
    assertTrue(NOTE_STRINGS.includes(r.note));
  });

  it('octave is a finite number', () => {
    const r = frequencyToNote(440);
    assertTrue(Number.isFinite(r.octave));
  });

  it('cents is an integer', () => {
    const r = frequencyToNote(440);
    assertTrue(Number.isInteger(r.cents));
  });

  it('frequency echoes the input', () => {
    const input = 349.23;
    const r = frequencyToNote(input);
    assertEqual(r.frequency, input);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// detectPitch — silent / low-signal
// ──────────────────────────────────────────────────────────────────────────────

describe('detectPitch — silent and low-signal', () => {
  const sampleRate = 44100;
  const bufLen = 4096;

  it('returns -1 for a silent buffer', () => {
    const buf = generateSilentBuffer(bufLen);
    const freq = detectPitch(buf, sampleRate);
    assertEqual(freq, -1);
  });

  it('returns -1 for a very low-amplitude buffer', () => {
    const buf = generateSineBuffer(440, sampleRate, bufLen);
    for (let i = 0; i < buf.length; i++) buf[i] *= 0.003;
    const freq = detectPitch(buf, sampleRate);
    assertEqual(freq, -1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// detectPitch — known sine-wave frequencies
// ──────────────────────────────────────────────────────────────────────────────

describe('detectPitch — known frequencies', () => {
  const sampleRate = 44100;
  const bufLen = 4096;

  function testFreq(expectedHz, tolerance) {
    const buf = generateSineBuffer(expectedHz, sampleRate, bufLen);
    const detected = detectPitch(buf, sampleRate);
    assertGreaterThan(detected, 0, `should detect a frequency, not -1`);
    assertClose(detected, expectedHz, tolerance, `expected ~${expectedHz} Hz`);
  }

  it('detects 440 Hz (A4) within 1 Hz', () => {
    testFreq(440, 1);
  });

  it('detects 261.63 Hz (C4) within 2 Hz', () => {
    testFreq(261.63, 2);
  });

  it('detects 329.63 Hz (E4) within 2 Hz', () => {
    testFreq(329.63, 2);
  });

  it('detects 392 Hz (G4) within 2 Hz', () => {
    testFreq(392, 2);
  });

  it('detects 880 Hz (A5) within 2 Hz', () => {
    testFreq(880, 2);
  });

  it('detects 130.81 Hz (C3) within 3 Hz', () => {
    testFreq(130.81, 3);
  });

  it('detects 174.61 Hz (F3) within 3 Hz', () => {
    testFreq(174.61, 3);
  });

  it('detects 523.25 Hz (C5) within 2 Hz', () => {
    testFreq(523.25, 2);
  });

  it('detects 55 Hz (A1, bass) within 3 Hz', () => {
    testFreq(55, 3);
  });

  it('detects 41.2 Hz (E1, low bass) within 5 Hz', () => {
    const buf = generateSineBuffer(41.2, sampleRate, 16384);
    const detected = detectPitch(buf, sampleRate);
    assertGreaterThan(detected, 0, 'should detect a frequency');
    assertClose(detected, 41.2, 5, 'expected ~41.2 Hz');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// detectPitch — robustness
// ──────────────────────────────────────────────────────────────────────────────

describe('detectPitch — robustness', () => {
  const sampleRate = 44100;
  const bufLen = 4096;

  it('detects frequency even with added noise', () => {
    const buf = generateSineBuffer(440, sampleRate, bufLen);
    for (let i = 0; i < bufLen; i++) {
      buf[i] += (Math.random() - 0.5) * 0.2;
    }
    const freq = detectPitch(buf, sampleRate);
    assertGreaterThan(freq, 0, 'should still detect a frequency');
    assertClose(freq, 440, 5, 'should be close to 440 Hz');
  });

  it('works with different sample rates', () => {
    for (const sr of [22050, 44100, 48000]) {
      const buf = generateSineBuffer(440, sr, bufLen);
      const freq = detectPitch(buf, sr);
      assertGreaterThan(freq, 0, `should detect frequency at ${sr} Hz sample rate`);
      assertClose(freq, 440, 3, `expected ~440 Hz at sample rate ${sr}`);
    }
  });

  it('works with different buffer lengths', () => {
    for (const len of [2048, 4096, 8192]) {
      const buf = generateSineBuffer(440, sampleRate, len);
      const freq = detectPitch(buf, sampleRate);
      assertGreaterThan(freq, 0, `should detect frequency with buffer length ${len}`);
      assertClose(freq, 440, 3, `expected ~440 Hz with buffer length ${len}`);
    }
  });

  it('does not confuse octave (A4 should not be detected as A3)', () => {
    const buf = generateSineBuffer(440, sampleRate, bufLen);
    const freq = detectPitch(buf, sampleRate);
    assertGreaterThan(freq, 350, 'should be above 350 Hz, not confused with A3 (220)');
    assertLessThan(freq, 550, 'should be below 550 Hz');
  });

  it('handles a signal with strong 2nd harmonic without octave error', () => {
    // Fundamental at 220 Hz + strong 2nd harmonic at 440 Hz
    const buf = new Float32Array(bufLen);
    for (let i = 0; i < bufLen; i++) {
      buf[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / sampleRate)
             + 0.7 * Math.sin(2 * Math.PI * 440 * i / sampleRate);
    }
    const freq = detectPitch(buf, sampleRate);
    assertGreaterThan(freq, 0, 'should detect a frequency');
    // Should prefer the fundamental (220) over the harmonic (440)
    assertClose(freq, 220, 5, 'should detect fundamental 220 Hz, not harmonic 440 Hz');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PitchSmoothing
// ──────────────────────────────────────────────────────────────────────────────

describe('PitchSmoothing', () => {
  it('returns null for silence', () => {
    const s = new PitchSmoothing(4, 2);
    const r = s.update(-1);
    assertFalse(r);
  });

  it('resets on silence after showing a note', () => {
    const s = new PitchSmoothing(4, 2);
    for (let i = 0; i < 5; i++) s.update(440);
    const r = s.update(-1);
    assertFalse(r);
  });

  it('requires minAgree samples before note is stable', () => {
    const s = new PitchSmoothing(4, 3);
    const r1 = s.update(440);
    assertTrue(r1);
    assertFalse(r1.stable, 'first reading should not be stable');

    const r2 = s.update(440);
    assertFalse(r2.stable, 'second reading should not be stable');

    const r3 = s.update(440);
    assertTrue(r3.stable, 'third reading should be stable');
  });

  it('shows the correct note after stabilisation', () => {
    const s = new PitchSmoothing(4, 3);
    for (let i = 0; i < 5; i++) s.update(440);
    const r = s.update(440);
    assertEqual(r.note, 'A');
    assertEqual(r.octave, 4);
    assertClose(r.cents, 0, 2);
  });

  it('switches note only after new note agrees minAgree times', () => {
    const s = new PitchSmoothing(4, 3);
    // Stabilise on A4
    for (let i = 0; i < 5; i++) s.update(440);
    let r = s.update(440);
    assertTrue(r.stable);
    assertEqual(r.note, 'A');

    // Feed C5 enough times to shift the median window
    r = s.update(523.25);
    r = s.update(523.25);
    // The median may still be A4 or C5 depending on window — either way
    // it should not yet be stable on C5 (need minAgree=3 consecutive)
    const wasC5 = r.note === 'C' && r.octave === 5;
    if (wasC5) {
      assertFalse(r.stable, 'should not be stable on C5 yet');
    }

    // Two more readings of C5 — now definitely stable on C5
    r = s.update(523.25);
    r = s.update(523.25);
    assertTrue(r.stable, 'should be stable on new note after minAgree');
    assertEqual(r.note, 'C');
    assertEqual(r.octave, 5);
  });

  it('rejects a single outlier reading', () => {
    const s = new PitchSmoothing(8, 3);
    // Stabilise on A4
    for (let i = 0; i < 10; i++) s.update(440);

    // One outlier at 880 Hz
    const r = s.update(880);
    // Should still show A4 or at least not be stable on A5
    if (r.note === 'A' && r.octave === 5) {
      assertFalse(r.stable, 'should not be stable on the outlier note');
    }
    // Next reading back to 440 should recover
    const r2 = s.update(440);
    const r3 = s.update(440);
    const r4 = s.update(440);
    assertTrue(r4.stable, 'should recover to A4');
    assertEqual(r4.note, 'A');
    assertEqual(r4.octave, 4);
  });

  it('handles slow frequency drift within the same note', () => {
    const s = new PitchSmoothing(8, 3);
    // Feed gradually changing frequency within A4 range
    for (let i = 0; i < 20; i++) {
      const freq = 438 + i * 0.3; // 438 → 444 Hz
      const r = s.update(freq);
      assertTrue(r, `should have a result at step ${i}`);
      assertEqual(r.note, 'A', `note should stay A at ${freq.toFixed(1)} Hz`);
      assertEqual(r.octave, 4, `octave should stay 4 at ${freq.toFixed(1)} Hz`);
    }
  });

  it('reset clears all state', () => {
    const s = new PitchSmoothing(4, 2);
    for (let i = 0; i < 5; i++) s.update(440);
    s.reset();
    const r = s.update(440);
    assertFalse(r.stable, 'after reset, first reading should not be stable');
  });

  it('handles single-element history correctly', () => {
    const s = new PitchSmoothing(8, 3);
    const r = s.update(440);
    assertTrue(r, 'should return a result');
    assertEqual(r.note, 'A');
    assertEqual(r.octave, 4);
    assertFalse(r.stable, 'single reading should not be stable with minAgree=3');
  });

  it('handles equal-frequency readings', () => {
    const s = new PitchSmoothing(4, 2);
    for (let i = 0; i < 6; i++) s.update(392); // G4
    const r = s.update(392);
    assertTrue(r.stable, 'should be stable on repeated identical readings');
    assertEqual(r.note, 'G');
    assertEqual(r.octave, 4);
    assertClose(r.cents, 0, 2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// generateSineBuffer / generateSilentBuffer helpers
// ──────────────────────────────────────────────────────────────────────────────

describe('generateSineBuffer', () => {
  it('returns a Float32Array of the requested length', () => {
    const buf = generateSineBuffer(440, 44100, 1024);
    assertTrue(buf instanceof Float32Array);
    assertEqual(buf.length, 1024);
  });

  it('amplitude stays in [-1, 1]', () => {
    const buf = generateSineBuffer(440, 44100, 4096);
    for (const v of buf) {
      assertLessThan(v, 1.0001);
      assertGreaterThan(v, -1.0001);
    }
  });
});

describe('generateSilentBuffer', () => {
  it('returns a Float32Array of all zeros', () => {
    const buf = generateSilentBuffer(1024);
    assertTrue(buf instanceof Float32Array);
    assertEqual(buf.length, 1024);
    for (const v of buf) {
      assertEqual(v, 0);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Integration: detectPitch → frequencyToNote pipeline
// ──────────────────────────────────────────────────────────────────────────────

describe('Integration: detectPitch → frequencyToNote', () => {
  const sampleRate = 44100;
  const bufLen = 4096;

  function tune(freqHz) {
    const buf = generateSineBuffer(freqHz, sampleRate, bufLen);
    const detected = detectPitch(buf, sampleRate);
    return detected > 0 ? frequencyToNote(detected) : null;
  }

  it('A4 sine → A4 note, ~0 cents', () => {
    const r = tune(440);
    assertTrue(r, 'should detect a note');
    assertEqual(r.note, 'A');
    assertEqual(r.octave, 4);
    assertClose(r.cents, 0, 5);
  });

  it('C4 sine → C4 note, ~0 cents', () => {
    const r = tune(261.63);
    assertTrue(r, 'should detect a note');
    assertEqual(r.note, 'C');
    assertEqual(r.octave, 4);
    assertClose(r.cents, 0, 5);
  });

  it('E4 sine → E4 note, ~0 cents', () => {
    const r = tune(329.63);
    assertTrue(r, 'should detect a note');
    assertEqual(r.note, 'E');
    assertEqual(r.octave, 4);
    assertClose(r.cents, 0, 5);
  });

  it('G4 sine → G4 note, ~0 cents', () => {
    const r = tune(392);
    assertTrue(r, 'should detect a note');
    assertEqual(r.note, 'G');
    assertEqual(r.octave, 4);
    assertClose(r.cents, 0, 10);
  });

  it('silent buffer → null (no note)', () => {
    const r = tune(0);
    assertFalse(r, 'silent buffer should yield null');
  });

  it('detects all 12 notes in a chromatic scale', () => {
    const detected = [];
    for (let i = 0; i < 12; i++) {
      const freq = 261.625565 * Math.pow(2, i / 12);
      const r = tune(freq);
      assertTrue(r, `should detect note at ${freq.toFixed(2)} Hz`);
      detected.push(r.note);
    }
    assertArrayEqual(detected, NOTE_STRINGS);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Integration: fallback and robustness paths
// ──────────────────────────────────────────────────────────────────────────────

describe('Integration: fallback and robustness paths', () => {
  const sampleRate = 44100;
  const bufLen = 4096;

  it('strong 2nd harmonic (weak fundamental) detects a valid pitch', () => {
    // Fundamental 440 Hz at 0.15 amplitude, 2nd harmonic 880 Hz at 0.9 amplitude.
    // The detector may lock onto either 440 Hz or 880 Hz depending on CMND shape.
    // Either way it should return a valid frequency (not -1) within a reasonable range.
    const buf = new Float32Array(bufLen);
    for (let i = 0; i < bufLen; i++) {
      buf[i] = 0.15 * Math.sin(2 * Math.PI * 440 * i / sampleRate)
             + 0.90 * Math.sin(2 * Math.PI * 880 * i / sampleRate);
    }
    const freq = detectPitch(buf, sampleRate);
    assertGreaterThan(freq, 0, 'should detect a frequency');
    assertTrue(
      (freq > 400 && freq < 500) || (freq > 800 && freq < 950),
      `should be near 440 Hz or 880 Hz, got ${freq.toFixed(1)} Hz`
    );
  });

  it('inharmonic two-tone signal does not crash and returns a frequency', () => {
    // 440 Hz + 500 Hz — no harmonic relationship.
    // The detector should still return something reasonable without error.
    const buf = new Float32Array(bufLen);
    for (let i = 0; i < bufLen; i++) {
      buf[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sampleRate)
             + 0.5 * Math.sin(2 * Math.PI * 500 * i / sampleRate);
    }
    const freq = detectPitch(buf, sampleRate);
    assertGreaterThan(freq, 0, 'should detect a frequency');
    assertLessThan(freq, 1000, 'frequency should be below 1000 Hz');
  });

  it('very low frequency near MIN_FREQ boundary', () => {
    // 32 Hz is just above MIN_FREQ (30 Hz) — needs a large buffer.
    const bufLen = 32768;
    const buf = generateSineBuffer(32, sampleRate, bufLen);
    const freq = detectPitch(buf, sampleRate);
    assertGreaterThan(freq, 0, 'should detect a frequency near MIN_FREQ');
    assertClose(freq, 32, 3, 'expected ~32 Hz');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Legacy autoCorrelate (backward compatibility)
// ──────────────────────────────────────────────────────────────────────────────

describe('autoCorrelate (legacy)', () => {
  const sampleRate = 44100;
  const bufLen = 4096;

  it('still works for 440 Hz', () => {
    const buf = generateSineBuffer(440, sampleRate, bufLen);
    const freq = autoCorrelate(buf, sampleRate);
    assertGreaterThan(freq, 0);
    assertClose(freq, 440, 2);
  });

  it('returns -1 for silence', () => {
    const buf = generateSilentBuffer(bufLen);
    assertEqual(autoCorrelate(buf, sampleRate), -1);
  });

  it('detects 261.63 Hz (C4)', () => {
    const buf = generateSineBuffer(261.63, sampleRate, bufLen);
    const freq = autoCorrelate(buf, sampleRate);
    assertGreaterThan(freq, 0);
    assertClose(freq, 261.63, 3);
  });

  it('detects 392 Hz (G4)', () => {
    const buf = generateSineBuffer(392, sampleRate, bufLen);
    const freq = autoCorrelate(buf, sampleRate);
    assertGreaterThan(freq, 0);
    assertClose(freq, 392, 3);
  });

  it('detects 659.25 Hz (E5)', () => {
    const buf = generateSineBuffer(659.25, sampleRate, bufLen);
    const freq = autoCorrelate(buf, sampleRate);
    assertGreaterThan(freq, 0);
    assertClose(freq, 659.25, 3);
  });

  it('returns -1 for very low-amplitude signal', () => {
    const buf = generateSineBuffer(440, sampleRate, bufLen);
    for (let i = 0; i < buf.length; i++) buf[i] *= 0.005;
    assertEqual(autoCorrelate(buf, sampleRate), -1);
  });
});

// ── Run ──────────────────────────────────────────────────────────────────────
run();
