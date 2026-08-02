/**
 * Deterministic PRNG. `xmur3` hashes a string into 4 seed words; `sfc32` is a
 * fast, well-distributed generator. The same seed string always yields the same
 * stream, so a given plant slot renders identically for the life of a session.
 */

export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** A 0..1 generator seeded by an arbitrary string. */
export function rngFrom(seed: string): () => number {
  const s = xmur3(seed);
  return sfc32(s(), s(), s(), s());
}

/** A fresh, human-ish random seed string (varies per reload). */
export function randomSeed(): string {
  return Math.floor(Math.random() * 1e9).toString(36);
}
