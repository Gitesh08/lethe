// Pure synchronous SHA-256 with no platform API calls.
// Works identically in Node, Bun, and the browser.
// Refs: REQ-PAR-2, INV-7

// SHA-256 initial hash values (first 32 bits of the fractional parts of
// the square roots of the first 8 primes).
const H0 = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

// SHA-256 round constants (first 32 bits of the fractional parts of
// the cube roots of the first 64 primes).
const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** Rotate right a 32-bit unsigned integer by `n` bits. */
function rotr32(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/**
 * Normalize a string before hashing:
 * 1. Normalize CRLF → LF.
 * 2. Strip trailing whitespace from each line.
 */
function normalize(input: string): string {
  const lf = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return lf
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
}

/** Encode a (normalized) string to UTF-8 bytes using only charCodeAt. */
function toUtf8Bytes(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate — pair with next code unit
      const hi = code;
      const lo = str.charCodeAt(++i);
      const cp = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00);
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    } else {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

/** Compress one 64-byte block into the running hash state. */
function processBlock(data: Uint8Array, offset: number, hash: Uint32Array): void {
  const w = new Uint32Array(64);
  const at = (arr: ArrayLike<number>, i: number): number => arr[i] ?? 0;
  for (let i = 0; i < 16; i++) {
    const o = offset + i * 4;
    w[i] = ((at(data, o) << 24) | (at(data, o + 1) << 16) | (at(data, o + 2) << 8) | at(data, o + 3)) >>> 0;
  }
  for (let i = 16; i < 64; i++) {
    const w15 = at(w, i - 15);
    const w2 = at(w, i - 2);
    const s0 = rotr32(w15, 7) ^ rotr32(w15, 18) ^ (w15 >>> 3);
    const s1 = rotr32(w2, 17) ^ rotr32(w2, 19) ^ (w2 >>> 10);
    w[i] = (at(w, i - 16) + s0 + at(w, i - 7) + s1) >>> 0;
  }

  let a = at(hash, 0), b = at(hash, 1), c = at(hash, 2), d = at(hash, 3);
  let e = at(hash, 4), f = at(hash, 5), g = at(hash, 6), h = at(hash, 7);

  for (let i = 0; i < 64; i++) {
    const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
    // `~e` yields a signed 32-bit value; force unsigned with >>> 0.
    const ch = ((e & f) ^ (~e & g)) >>> 0;
    const temp1 = (h + S1 + ch + at(K, i) + at(w, i)) >>> 0;
    const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (S0 + maj) >>> 0;

    h = g; g = f; f = e;
    e = (d + temp1) >>> 0;
    d = c; c = b; b = a;
    a = (temp1 + temp2) >>> 0;
  }

  const next = [a, b, c, d, e, f, g, h];
  for (let i = 0; i < 8; i++) {
    hash[i] = (at(hash, i) + (next[i] ?? 0)) >>> 0;
  }
}

/**
 * Compute the SHA-256 hash of `input`.
 *
 * Input is normalized before hashing (CRLF → LF, trailing whitespace
 * stripped per line) so the hash is content-stable across editors.
 *
 * Returns a lowercase 64-character hex string.
 *
 * @example
 * sha256("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
 */
export function sha256(input: string): string {
  const normalized = normalize(input);
  const msg = toUtf8Bytes(normalized);
  const msgLen = msg.length;

  // Pre-processing: append bit '1' (0x80), then pad to 56 mod 64 bytes,
  // then append the 64-bit big-endian bit-length.
  const bitLen = msgLen * 8;
  const padLen = ((55 - msgLen) % 64 + 64) % 64 + 1; // ≥ 1, fills to 56 mod 64
  const padded = new Uint8Array(msgLen + padLen + 8);
  padded.set(msg);
  padded[msgLen] = 0x80;
  // Encode bit-length as 64-bit big-endian; JS numbers are safe to 2^53 so
  // we only ever need the lower 32 bits for realistic inputs.
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  padded[padded.length - 8] = (hi >>> 24) & 0xff;
  padded[padded.length - 7] = (hi >>> 16) & 0xff;
  padded[padded.length - 6] = (hi >>> 8) & 0xff;
  padded[padded.length - 5] = hi & 0xff;
  padded[padded.length - 4] = (lo >>> 24) & 0xff;
  padded[padded.length - 3] = (lo >>> 16) & 0xff;
  padded[padded.length - 2] = (lo >>> 8) & 0xff;
  padded[padded.length - 1] = lo & 0xff;

  const hash = new Uint32Array([...H0]);
  for (let offset = 0; offset < padded.length; offset += 64) {
    processBlock(padded, offset, hash);
  }

  // Encode hash words as hex
  let hex = "";
  for (let i = 0; i < 8; i++) {
    hex += ((hash[i] ?? 0) >>> 0).toString(16).padStart(8, "0");
  }
  return hex;
}
