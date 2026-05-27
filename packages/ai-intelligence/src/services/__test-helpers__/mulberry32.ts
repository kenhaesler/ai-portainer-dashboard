/**
 * Mulberry32 — a tiny, fast, deterministic 32-bit PRNG.
 *
 * Test-only utility. Used by anomaly-detector / trace-anomaly tests to seed
 * synthetic time-series with documented reproducible noise.
 *
 * Reference: https://gist.github.com/tommyettinger/46a3b8c9c2e72894ac9c
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard normal (mean 0, std 1) via the Box-Muller transform driven by a
 * seeded uniform RNG. Returns the next value in a deterministic stream.
 */
export function gaussianFactory(rng: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    // Reject zero to avoid -Infinity from log(0).
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const mag = Math.sqrt(-2 * Math.log(u));
    const z0 = mag * Math.cos(2 * Math.PI * v);
    const z1 = mag * Math.sin(2 * Math.PI * v);
    spare = z1;
    return z0;
  };
}
