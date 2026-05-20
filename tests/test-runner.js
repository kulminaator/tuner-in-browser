/**
 * test-runner.js — A zero-dependency home-grown test framework.
 *
 * Usage (Node):
 *   node tests/test-runner.js tests/test-tuner.js
 *
 * API:
 *   describe(name, fn)       — groups tests
 *   it(name, fn)             — defines a single test
 *   assertEqual(a, b, msg)   — strict equality
 *   assertClose(a, b, eps, msg) — numeric closeness
 *   assertTrue(v, msg)       — truthy check
 *   assertFalse(v, msg)      — falsy check
 *   assertThrows(fn, msg)    — expects an exception
 *   assertHasProps(obj, keys, msg) — object shape check
 */

// ── State ──────────────────────────────────────────────────────────────────
let results = [];
let currentGroup = '';
let indentLevel = 0;

function indent() {
  return '  '.repeat(indentLevel);
}

// ── Public API ─────────────────────────────────────────────────────────────

function describe(name, fn) {
  currentGroup = name;
  indentLevel++;
  try {
    fn();
  } finally {
    indentLevel--;
    currentGroup = '';
  }
}

function it(name, fn) {
  const fullName = currentGroup ? `${currentGroup} › ${name}` : name;
  const start = performance.now();

  let status;
  let error;
  try {
    fn();
    status = 'pass';
  } catch (e) {
    status = 'fail';
    error = e;
  }

  const elapsed = performance.now() - start;
  results.push({ name: fullName, status, error, elapsed });
}

// ── Assertions ─────────────────────────────────────────────────────────────

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      message
        ? `${message}: expected ${format(expected)}, got ${format(actual)}`
        : `expected ${format(expected)}, got ${format(actual)}`
    );
  }
}

function assertClose(actual, expected, epsilon, message) {
  const diff = Math.abs(actual - expected);
  if (diff > epsilon) {
    throw new Error(
      message
        ? `${message}: expected ${expected} ±${epsilon}, got ${actual} (diff ${diff.toFixed(6)})`
        : `expected ${expected} ±${epsilon}, got ${actual} (diff ${diff.toFixed(6)})`
    );
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(message ? `${message}: expected truthy, got ${format(value)}` : `expected truthy, got ${format(value)}`);
  }
}

function assertFalse(value, message) {
  if (value) {
    throw new Error(message ? `${message}: expected falsy, got ${format(value)}` : `expected falsy, got ${format(value)}`);
  }
}

function assertThrows(fn, msg) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error(msg || 'expected function to throw');
  }
}

function assertHasProps(obj, keys, message) {
  for (const key of keys) {
    if (!(key in obj)) {
      throw new Error(
        message
          ? `${message}: missing property "${key}"`
          : `missing property "${key}"`
      );
    }
  }
}

function assertGreaterThan(actual, threshold, message) {
  if (actual <= threshold) {
    throw new Error(
      message
        ? `${message}: expected ${actual} > ${threshold}`
        : `expected ${actual} > ${threshold}`
    );
  }
}

function assertLessThan(actual, threshold, message) {
  if (actual >= threshold) {
    throw new Error(
      message
        ? `${message}: expected ${actual} < ${threshold}`
        : `expected ${actual} < ${threshold}`
    );
  }
}

function assertArrayEqual(actual, expected, message) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) {
    throw new Error(message || 'both values must be arrays');
  }
  if (actual.length !== expected.length) {
    throw new Error(
      message
        ? `${message}: length mismatch ${actual.length} vs ${expected.length}`
        : `length mismatch ${actual.length} vs ${expected.length}`
    );
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        message
          ? `${message}: mismatch at index ${i}: expected ${format(expected[i])}, got ${format(actual[i])}`
          : `mismatch at index ${i}: expected ${format(expected[i])}, got ${format(actual[i])}`
      );
    }
  }
}

// ── WAV parser (minimal: mono, 16-bit PCM only) ───────────────────────────

/**
 * Parse a WAV file (Buffer) into a Float32Array of sample values in [-1, 1].
 * Supports mono and stereo 16-bit PCM (stereo is downmixed to mono).
 * Throws on unsupported formats.
 * @param {Buffer} wavData - Raw file bytes
 * @returns {{ samples: Float32Array, sampleRate: number, channels: number }}
 */
function parseWav(wavData) {
  // Validate RIFF header
  const riff = wavData.toString('ascii', 0, 4);
  if (riff !== 'RIFF') throw new Error('Not a RIFF file');
  const wave = wavData.toString('ascii', 8, 12);
  if (wave !== 'WAVE') throw new Error('Not a WAVE file');

  let offset = 12;
  let dataOffset = -1;
  let dataLength = 0;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;

  // Walk chunks
  while (offset < wavData.length) {
    const chunkId = wavData.toString('ascii', offset, offset + 4);
    const chunkSize = wavData.readUInt32LE(offset + 4);

    if (chunkId === 'fmt ') {
      const audioFormat = wavData.readUInt16LE(offset + 8);
      if (audioFormat !== 1) throw new Error(`Unsupported audio format: ${audioFormat} (expected PCM)`);
      channels = wavData.readUInt16LE(offset + 10);
      sampleRate = wavData.readUInt32LE(offset + 12);
      bitsPerSample = wavData.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataLength = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  if (dataOffset === -1) throw new Error('No data chunk found');
  if (channels < 1 || channels > 2) throw new Error(`Unsupported channel count: ${channels}`);
  if (bitsPerSample !== 16) throw new Error(`Only 16-bit WAV supported (got ${bitsPerSample}-bit)`);

  const bytesPerSample = bitsPerSample / 8;
  const numFrames = dataLength / (channels * bytesPerSample);
  const samples = new Float32Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      const raw = wavData.readInt16LE(dataOffset + (i * channels + ch) * bytesPerSample);
      sum += raw / 32768;
    }
    samples[i] = sum / channels;
  }

  return { samples, sampleRate, channels };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function format(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function run() {
  const pass = results.filter((r) => r.status === 'pass');
  const fail = results.filter((r) => r.status === 'fail');

  // Print results
  for (const r of results) {
    const icon = r.status === 'pass' ? '✓' : '✗';
    const time = r.elapsed < 1 ? `${r.elapsed.toFixed(2)}ms` : `${r.elapsed.toFixed(1)}ms`;
    console.log(`${indent()}${icon} ${r.name} (${time})`);
    if (r.error) {
      console.error(`${indent()}  ${r.error.message}`);
    }
  }

  console.log();
  console.log(
    `Total: ${results.length}  Passed: ${pass.length}  Failed: ${fail.length}`
  );

  if (fail.length > 0) {
    process.exit(1);
  }
}

// ── Module exports ─────────────────────────────────────────────────────────
export {
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
};
