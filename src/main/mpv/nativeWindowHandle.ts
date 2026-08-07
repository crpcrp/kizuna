/**
 * Reads the native parent-window ID from Electron's
 * `BrowserWindow.getNativeWindowHandle()` buffer.
 *
 * Windows exposes an 8-byte HWND in the 64-bit builds Kizuna supports.
 * Electron exposes the Linux X11 Window ID as a 4-byte XID, even when the
 * Electron process itself is 64-bit.
 */
export function windowIdFromHandleBuffer(
  buf: Buffer,
  platform: NodeJS.Platform = process.platform
): bigint {
  if (platform !== 'win32' && platform !== 'linux') {
    throw new Error(`Unsupported platform for native window embedding: ${platform}`)
  }
  if (platform === 'linux') {
    if (buf.length < 4) {
      throw new Error(
        `Native window handle buffer for ${platform} must contain at least 4 bytes; received ${buf.length}`
      )
    }
    return BigInt(buf.readUInt32LE(0))
  }
  if (buf.length < 8) {
    throw new Error(
      `Native window handle buffer for ${platform} must contain at least 8 bytes; received ${buf.length}`
    )
  }
  return buf.readBigUInt64LE(0)
}
