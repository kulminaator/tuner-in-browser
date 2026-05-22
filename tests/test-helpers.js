/**
 * test-helpers.js — Utility helpers for generating test audio buffers.
 *
 * These are used by the test suite and do not belong in production code.
 */

/**
 * Generate a Float32Array containing a pure sine wave at the given frequency.
 * @param {number} frequency  - Frequency in Hz
 * @param {number} sampleRate - Sample rate in Hz
 * @param {number} length     - Number of samples
 * @returns {Float32Array}
 */
export function generateSineBuffer(frequency, sampleRate, length) {
  const buffer = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    buffer[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate);
  }
  return buffer;
}

/**
 * Generate a Float32Array of all zeros (silence).
 * @param {number} length - Number of samples
 * @returns {Float32Array}
 */
export function generateSilentBuffer(length) {
  return new Float32Array(length);
}
