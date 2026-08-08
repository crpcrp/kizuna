/**
 * Reads the native parent-window ID from Electron's
 * `BrowserWindow.getNativeWindowHandle()` buffer.
 *
 * Windows exposes an 8-byte HWND in the 64-bit builds Kizuna supports.
 * Electron documents Linux's native type as X11 `Window` (`unsigned long`),
 * but current Electron builds serialize the XID into a 4-byte Buffer on some
 * 64-bit Linux/Ozone configurations. Accept both observed representations.
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
    const windowId = buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0))
    // Wayland-backed Electron windows can expose a non-X11 sentinel here.
    // Passing it to mpv produces only a remote XGetWindowAttributes error and
    // an IPC timeout, so fail at the actual boundary with actionable context.
    if (windowId <= 1n) {
      throw new Error(
        `Invalid Linux X11 native window ID ${windowId} (raw handle ${buf.toString('hex')}); launch Electron with --ozone-platform=x11`
      )
    }
    return windowId
  }
  if (buf.length < 8) {
    throw new Error(
      `Native window handle buffer for ${platform} must contain at least 8 bytes; received ${buf.length}`
    )
  }
  return buf.readBigUInt64LE(0)
}
