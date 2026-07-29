// Phase 1 · Task 2 — HWND extraction for mpv `--wid` embedding.

/**
 * Reads a Win32 HWND out of the Buffer that Electron's
 * `BrowserWindow.getNativeWindowHandle()` returns — an 8-byte little-endian
 * pointer on Win64. Ported from the spike's hwndFromWindow().
 */
export function hwndFromHandleBuffer(buf: Buffer): bigint {
  return buf.readBigUInt64LE(0)
}
