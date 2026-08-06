/**
 * Reads the native parent-window ID from Electron's
 * `BrowserWindow.getNativeWindowHandle()` buffer.
 *
 * Both supported targets expose an 8-byte native value in the 64-bit builds
 * Kizuna supports: an HWND on Windows and an X11 Window on Linux.
 */
export function windowIdFromHandleBuffer(
  buf: Buffer,
  platform: NodeJS.Platform = process.platform
): bigint {
  if (platform !== 'win32' && platform !== 'linux') {
    throw new Error(`Unsupported platform for native window embedding: ${platform}`)
  }
  if (buf.length < 8) {
    throw new Error(
      `Native window handle buffer for ${platform} must contain at least 8 bytes; received ${buf.length}`
    )
  }
  return buf.readBigUInt64LE(0)
}
