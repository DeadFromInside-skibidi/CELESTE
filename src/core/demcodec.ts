// Compact, lossless packing for 16-bit elevation grids.
//
// Terrain is smooth, so each sample is predicted from its already-stored neighbours with the
// plane predictor (left + up - upper-left) and only the residual is kept. Residuals are zig-zag
// encoded and written as two byte planes (all low bytes, then all high bytes): the high plane
// is almost entirely zero, which a general-purpose compressor (gzip) then squeezes hard.

/** Grid -> byte planes (to be gzip-compressed by the caller). */
export function encodeDem(grid: Int16Array, width: number): Uint8Array {
  const n = grid.length;
  const out = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = i % width;
    const left = x ? grid[i - 1] : 0;
    const up = i >= width ? grid[i - width] : 0;
    const upLeft = x && i >= width ? grid[i - width - 1] : 0;
    const d = (grid[i] - (left + up - upLeft)) << 16 >> 16; // wrap to int16
    const z = ((d << 1) ^ (d >> 15)) & 0xffff; // zig-zag: small magnitudes -> small unsigned
    out[i] = z & 0xff;
    out[n + i] = z >> 8;
  }
  return out;
}

/** Inverse of encodeDem. */
export function decodeDem(bytes: Uint8Array, width: number): Int16Array {
  const n = bytes.length / 2;
  const grid = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const x = i % width;
    const left = x ? grid[i - 1] : 0;
    const up = i >= width ? grid[i - width] : 0;
    const upLeft = x && i >= width ? grid[i - width - 1] : 0;
    const z = bytes[i] | (bytes[n + i] << 8);
    grid[i] = left + up - upLeft + ((z >>> 1) ^ -(z & 1)); // Int16Array store wraps to int16
  }
  return grid;
}
