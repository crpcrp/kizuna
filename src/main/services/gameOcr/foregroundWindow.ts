// Electron cannot query another process's foreground window; titles are not stable identities.

import { createRequire } from 'node:module'

const MAX_EXECUTABLE_PATH_LENGTH = 32_767

const MAX_WINDOW_DIMENSION = 16_384

/** A rectangle in physical desktop pixels, as Windows reports it. */
export interface PhysicalRect {
  x: number
  y: number
  width: number
  height: number
}

export interface RawForegroundWindow {
  /** Decimal string: a 64-bit HWND can exceed JavaScript's safe integer range. */
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

export interface ForegroundWindowNative {
  read(): RawForegroundWindow | undefined
  dispose?(): void
}

export type ForegroundWindowRejection =
  | 'query-failed'
  | 'no-foreground'
  | 'own-process'
  | 'minimized'
  | 'invisible'
  | 'cloaked'
  | 'invalid-window'

export interface ForegroundWindow {
  hwnd: string
  pid: number
  executablePath?: string
  /** Basename only, so the development log never carries a full path. */
  executableName?: string
  physicalBounds: PhysicalRect
}

export type ForegroundWindowReading =
  | { ok: true; window: ForegroundWindow }
  | { ok: false; reason: ForegroundWindowRejection; detail?: string }

export interface ForegroundWindowSource {
  /** Synchronous to avoid yielding shortcut dispatch; failures become display-fallback readings. */
  current(): ForegroundWindowReading
  dispose(): void
}

export interface ForegroundWindowSourceOptions {
  native: ForegroundWindowNative
  ownProcessId: number
}

// Windows can cloak UWP/virtual-desktop windows while leaving valid bounds and titles.
export function createForegroundWindowSource(
  options: ForegroundWindowSourceOptions
): ForegroundWindowSource {
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

export function evaluateForegroundWindow(
  raw: RawForegroundWindow | undefined,
  ownProcessId: number
): ForegroundWindowReading {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'no-foreground' }

  const hwnd = normalizeHandle(raw.hwnd)
  if (hwnd === undefined) return { ok: false, reason: 'no-foreground' }

  // Content protection makes capturing Kizuna's frozen frame produce a black image.
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

/** Strip leading zeros for source-id comparisons without rounding a 64-bit HWND. */
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

function basename(path: string): string {
  const separator = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return separator >= 0 ? path.slice(separator + 1) : path
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

const GA_ROOT = 2
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const DWMWA_CLOAKED = 14
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

/** Windows path limit, in UTF-16 code units. */
const PATH_BUFFER_LENGTH = 32_768

export interface KoffiLike {
  load(library: string): {
    func(signature: string): (...args: never[]) => never
  }
  pointer(name: string, type: unknown): unknown
  opaque(): unknown
  address(value: unknown): bigint | number
  decode(buffer: Buffer, type: string, length: number): string
}

// Koffi uses prebuilt Node-API binaries, avoiding an Electron rebuild or a helper-process spawn.
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

  const rectBuffer = Buffer.alloc(16)
  const cloakedBuffer = Buffer.alloc(4)
  const pathBuffer = Buffer.alloc(PATH_BUFFER_LENGTH * 2)

  const readRect = (hwnd: unknown): PhysicalRect | undefined => {
    // DWM excludes the invisible resize border (8 px per side at 100% on Windows 11);
    // GetWindowRect would leave a transparent overlay margin.
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
    // Elevated/protected processes may deny path queries while HWND and PID remain usable.
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
      // Electron enumerates the root window, even when an owned child has focus.
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

// Native initialization failure must preserve display capture.
export function createProductionForegroundWindowSource(): ForegroundWindowSource {
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
  return createForegroundWindowSource({ native, ownProcessId: process.pid })
}
