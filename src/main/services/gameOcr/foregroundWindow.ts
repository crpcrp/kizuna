// The Windows-native boundary Game OCR needs to capture the focused window.
//
// Electron enumerates capturable windows but does not expose the Win32
// foreground window of another process. `BrowserWindow.getFocusedWindow()`
// only covers this process, and window titles are not identities: they
// duplicate, empty, and change while a game runs. Selecting the right window
// therefore needs a narrow native query, and this file is all of it.
//
// The query is split in two so almost none of it needs a Windows host to test.
// `ForegroundWindowNative` is a faithful, minimal mirror of the Win32 calls and
// nothing else; every rejection, validation, and normalization rule lives in
// the pure layer below it and is exercised with fakes.

import { createRequire } from 'node:module'

/** Longest executable path carried out of the native boundary. */
const MAX_EXECUTABLE_PATH_LENGTH = 32_767

/** Largest window edge accepted, in physical pixels. Matches the OCR contract. */
const MAX_WINDOW_DIMENSION = 16_384

/** A rectangle in physical desktop pixels, as Windows reports it. */
export interface PhysicalRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * One raw reading of the foreground window.
 *
 * Deliberately shaped like a serializable record rather than a handle object:
 * it is the same contract a standalone helper process would print, so the
 * native implementation can be replaced without touching the rules below.
 */
export interface RawForegroundWindow {
  /**
   * The root window handle as a decimal string. A string and never a number,
   * because a 64-bit HWND does not survive JavaScript's safe integer range and
   * a rounded handle silently matches the wrong window.
   */
  hwnd: string
  pid: number
  /** Absent when the process refuses `PROCESS_QUERY_LIMITED_INFORMATION`. */
  executablePath?: string
  minimized: boolean
  visible: boolean
  cloaked: boolean
  /** `DWMWA_EXTENDED_FRAME_BOUNDS`, falling back to `GetWindowRect`. */
  physicalBounds?: PhysicalRect
}

/** The Win32 surface. The production implementation is the only untested part. */
export interface ForegroundWindowNative {
  /** Returns `undefined` when there is no usable foreground window at all. */
  read(): RawForegroundWindow | undefined
  dispose?(): void
}

/** Why a foreground window was not usable. Each maps to display fallback. */
export type ForegroundWindowRejection =
  | 'unsupported'
  | 'query-failed'
  | 'no-foreground'
  | 'own-process'
  | 'minimized'
  | 'invisible'
  | 'cloaked'
  | 'invalid-window'

/** A validated foreground window, in physical desktop pixels. */
export interface ForegroundWindow {
  hwnd: string
  pid: number
  executablePath?: string
  /** Basename only, so ordinary diagnostics never carry a full path. */
  executableName?: string
  physicalBounds: PhysicalRect
}

export type ForegroundWindowReading =
  | { ok: true; window: ForegroundWindow }
  | { ok: false; reason: ForegroundWindowRejection; detail?: string }

export interface ForegroundWindowSource {
  /**
   * One observation. Synchronous by design: the underlying calls cost
   * microseconds, and the shortcut path must not yield to Electron's
   * global-shortcut dispatch for something this cheap.
   *
   * Never throws. Every failure is a reading the caller turns into display
   * capture, because losing focused-window selection must not lose the capture.
   */
  current(): ForegroundWindowReading
  dispose(): void
}

export interface ForegroundWindowSourceOptions {
  native: ForegroundWindowNative
  /** Kizuna's own PID. Its windows are never a capture target. */
  ownProcessId: number
  platform?: NodeJS.Platform
}

/**
 * Applies the selection rules to a raw native reading.
 *
 * A minimized, hidden, or cloaked window has no pixels to capture; a cloaked
 * one is the case that looks fine and is not, because Windows keeps
 * background UWP windows and virtual-desktop residents cloaked with valid
 * bounds and a valid title.
 */
export function createForegroundWindowSource(
  options: ForegroundWindowSourceOptions
): ForegroundWindowSource {
  if ((options.platform ?? process.platform) !== 'win32') {
    return {
      current: () => ({ ok: false, reason: 'unsupported' }),
      dispose: () => {}
    }
  }

  return {
    current(): ForegroundWindowReading {
      let raw: RawForegroundWindow | undefined
      try {
        raw = options.native.read()
      } catch (error) {
        return {
          ok: false,
          reason: 'query-failed',
          detail: error instanceof Error ? error.message : String(error)
        }
      }
      return evaluateForegroundWindow(raw, options.ownProcessId)
    },

    dispose(): void {
      try {
        options.native.dispose?.()
      } catch {
        // Releasing a native handle must never fail a shutdown.
      }
    }
  }
}

/** Pure. The whole rejection and normalization policy, in one place. */
export function evaluateForegroundWindow(
  raw: RawForegroundWindow | undefined,
  ownProcessId: number
): ForegroundWindowReading {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'no-foreground' }

  const hwnd = normalizeHandle(raw.hwnd)
  if (hwnd === undefined) return { ok: false, reason: 'no-foreground' }

  // Kizuna's own windows are rejected before anything else is read. The
  // frozen frame is excluded from desktop capture, so capturing it would
  // produce a black frame; the player window would simply be the wrong thing.
  if (Number.isSafeInteger(raw.pid) && raw.pid === ownProcessId) {
    return { ok: false, reason: 'own-process' }
  }
  if (!isPositiveInteger(raw.pid)) return { ok: false, reason: 'invalid-window' }

  if (raw.minimized) return { ok: false, reason: 'minimized' }
  if (!raw.visible) return { ok: false, reason: 'invisible' }
  if (raw.cloaked) return { ok: false, reason: 'cloaked' }

  const physicalBounds = normalizeRect(raw.physicalBounds)
  if (!physicalBounds) return { ok: false, reason: 'invalid-window' }

  const executablePath = normalizeString(raw.executablePath, MAX_EXECUTABLE_PATH_LENGTH)
  return {
    ok: true,
    window: {
      hwnd,
      pid: raw.pid,
      ...(executablePath ? { executablePath, executableName: basename(executablePath) } : {}),
      physicalBounds
    }
  }
}

/**
 * Normalizes a decimal handle string. Leading zeros are stripped so a cached
 * comparison against Electron's source id is an exact string match, and a
 * handle is never parsed into a number: HWND values above 2^53 round.
 */
export function normalizeHandle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const digits = value.trim()
  if (!/^[0-9]+$/.test(digits) || digits.length > 20) return undefined
  const normalized = digits.replace(/^0+(?=[0-9])/, '')
  return normalized === '0' ? undefined : normalized
}

function normalizeRect(value: PhysicalRect | undefined): PhysicalRect | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { x, y, width, height } = value
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined
  // A window that has been created but never laid out reports an empty
  // rectangle; there is nothing to capture and nothing to cover.
  if (width <= 0 || height <= 0) return undefined
  if (width > MAX_WINDOW_DIMENSION || height > MAX_WINDOW_DIMENSION) return undefined
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  }
}

function normalizeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  // A NUL-padded fixed buffer is the ordinary shape of a Win32 string read.
  const text = value.replace(/\0.*$/s, '').trim()
  return text === '' || text.length > maxLength ? undefined : text
}

/** Windows-only basename. `win32.basename` would follow the host separator. */
function basename(path: string): string {
  const separator = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return separator >= 0 ? path.slice(separator + 1) : path
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/* ------------------------------------------------------------------------- *
 * The native implementation.
 * ------------------------------------------------------------------------- */

const GA_ROOT = 2
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const DWMWA_CLOAKED = 14
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

/** Widest path Windows accepts, in UTF-16 code units. */
const PATH_BUFFER_LENGTH = 32_768

/** The slice of Koffi's API this shim uses. Exported so tests can stand in. */
export interface KoffiLike {
  load(library: string): {
    func(signature: string): (...args: never[]) => never
  }
  pointer(name: string, type: unknown): unknown
  opaque(): unknown
  address(value: unknown): bigint | number
  decode(buffer: Buffer, type: string, length: number): string
}

/**
 * Builds the Win32 reader.
 *
 * Koffi is used rather than a bundled helper executable or a compiled addon:
 * it ships a prebuilt Node-API binary per platform, so no compiler, vendor
 * payload, or per-Electron rebuild is involved, and an in-process call costs
 * microseconds where spawning a helper costs tens of milliseconds on a path
 * whose whole budget the user feels.
 *
 * Loaded lazily and only on Windows, so no other platform pays for it and an
 * unusable module degrades to display capture rather than breaking startup.
 */
export function createWin32ForegroundWindowNative(
  loadKoffi: () => KoffiLike = () => createRequire(import.meta.url)('koffi') as KoffiLike
): ForegroundWindowNative {
  const koffi = loadKoffi()
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  const dwmapi = koffi.load('dwmapi.dll')

  koffi.pointer('HWND', koffi.opaque())

  const GetForegroundWindow = user32.func('HWND __stdcall GetForegroundWindow()')
  const GetAncestor = user32.func('HWND __stdcall GetAncestor(HWND hwnd, uint32 flags)')
  const IsIconic = user32.func('int __stdcall IsIconic(HWND hwnd)')
  const IsWindowVisible = user32.func('int __stdcall IsWindowVisible(HWND hwnd)')
  const GetWindowThreadProcessId = user32.func(
    'uint32 __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ uint32 *pid)'
  )
  const GetWindowRect = user32.func('int __stdcall GetWindowRect(HWND hwnd, _Out_ void *rect)')
  const DwmGetWindowAttribute = dwmapi.func(
    'int32 __stdcall DwmGetWindowAttribute(HWND hwnd, uint32 attribute, _Out_ void *value, uint32 size)'
  )
  const OpenProcess = kernel32.func(
    'void * __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)'
  )
  const CloseHandle = kernel32.func('int __stdcall CloseHandle(void *handle)')
  const QueryFullProcessImageNameW = kernel32.func(
    'int __stdcall QueryFullProcessImageNameW(void *process, uint32 flags, _Out_ char16_t *name, _Inout_ uint32 *size)'
  )

  // Reused across queries; the shortcut path allocates nothing per capture.
  const rectBuffer = Buffer.alloc(16)
  const cloakedBuffer = Buffer.alloc(4)
  const pathBuffer = Buffer.alloc(PATH_BUFFER_LENGTH * 2)

  const readRect = (hwnd: unknown): PhysicalRect | undefined => {
    // The extended frame bounds are what the compositor actually draws, and
    // exclude the invisible resize border `GetWindowRect` includes — measured
    // as an 8px inset per side at 100% on Windows 11. Using GetWindowRect for
    // the overlay would leave a transparent margin over the live game.
    const fromDwm =
      DwmGetWindowAttribute(
        hwnd as never,
        DWMWA_EXTENDED_FRAME_BOUNDS as never,
        rectBuffer as never,
        16 as never
      ) === 0
    if (!fromDwm && !GetWindowRect(hwnd as never, rectBuffer as never)) return undefined
    const left = rectBuffer.readInt32LE(0)
    const top = rectBuffer.readInt32LE(4)
    const right = rectBuffer.readInt32LE(8)
    const bottom = rectBuffer.readInt32LE(12)
    return { x: left, y: top, width: right - left, height: bottom - top }
  }

  const readExecutablePath = (pid: number): string | undefined => {
    // Access is routinely denied for elevated or protected processes. The
    // handle and PID stay usable, so this is optional metadata, not a failure.
    const process = OpenProcess(
      PROCESS_QUERY_LIMITED_INFORMATION as never,
      0 as never,
      pid as never
    )
    if (!process) return undefined
    try {
      const size = [PATH_BUFFER_LENGTH]
      if (!QueryFullProcessImageNameW(process, 0 as never, pathBuffer as never, size as never)) {
        return undefined
      }
      return koffi.decode(pathBuffer, 'char16_t', (size[0] as number) * 2)
    } finally {
      CloseHandle(process)
    }
  }

  return {
    read(): RawForegroundWindow | undefined {
      const foreground = GetForegroundWindow()
      if (!foreground) return undefined
      // A game's real window may be an owned child; the root is what
      // `desktopCapturer` enumerates and what the overlay has to cover.
      const hwnd = GetAncestor(foreground as never, GA_ROOT as never) || foreground
      const address = koffi.address(hwnd)
      if (!address) return undefined

      const pid = [0]
      GetWindowThreadProcessId(hwnd as never, pid as never)

      const cloaked =
        DwmGetWindowAttribute(
          hwnd as never,
          DWMWA_CLOAKED as never,
          cloakedBuffer as never,
          4 as never
        ) === 0 && cloakedBuffer.readUInt32LE(0) !== 0

      const processId = pid[0] as number
      return {
        hwnd: String(address),
        pid: processId,
        ...((): { executablePath?: string } => {
          const path = processId ? readExecutablePath(processId) : undefined
          return path ? { executablePath: path } : {}
        })(),
        minimized: Boolean(IsIconic(hwnd as never)),
        visible: Boolean(IsWindowVisible(hwnd as never)),
        cloaked,
        physicalBounds: readRect(hwnd)
      }
    }
  }
}

/**
 * Production factory. Any failure to load or initialize the native boundary
 * is reported as a rejection, never thrown: Game OCR keeps working through
 * display capture on a machine where this cannot run.
 */
export function createProductionForegroundWindowSource(
  platform: NodeJS.Platform = process.platform,
  ownProcessId: number = process.pid
): ForegroundWindowSource {
  if (platform !== 'win32') {
    return { current: () => ({ ok: false, reason: 'unsupported' }), dispose: () => {} }
  }
  let native: ForegroundWindowNative
  try {
    native = createWin32ForegroundWindowNative()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      current: () => ({ ok: false, reason: 'query-failed', detail }),
      dispose: () => {}
    }
  }
  return createForegroundWindowSource({ native, ownProcessId, platform })
}
