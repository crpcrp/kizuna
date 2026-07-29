// mpv `audio-device-list` entries plus the restore-time device decision.
// Pure data + pure functions — no I/O, so both main (controller parse) and the
// renderer (device picker, restore) share one definition.

/** One entry of mpv's `audio-device-list` property. `'auto'` is always present
 * as the default entry. */
export interface AudioDevice {
  name: string
  description: string
}

/** The special device meaning "let mpv follow the OS default output". */
export const AUTO_AUDIO_DEVICE = 'auto'

/**
 * Pure. Defensively parses mpv's `audio-device-list` payload into a clean
 * `AudioDevice[]`. mpv returns an array of `{ name, description }`; anything
 * else — a non-array, a null, an entry missing a string `name` — yields `[]`
 * or is dropped, so a malformed IPC reply never crashes the device menu. A
 * missing/blank description falls back to the device name.
 */
export function parseAudioDeviceList(raw: unknown): AudioDevice[] {
  if (!Array.isArray(raw)) return []
  const result: AudioDevice[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { name, description } = entry as Record<string, unknown>
    if (typeof name !== 'string' || name === '') continue
    const desc = typeof description === 'string' && description !== '' ? description : name
    result.push({ name, description: desc })
  }
  return result
}

/**
 * Pure. The output-device picker's rows: the mpv device list, but always led by
 * an `'auto'` entry so "follow the OS default" is selectable even before the
 * list has been fetched (or if mpv omitted it). A duplicate `'auto'` from mpv
 * is dropped.
 */
export function audioDeviceMenuList(devices: AudioDevice[]): AudioDevice[] {
  const auto: AudioDevice = { name: AUTO_AUDIO_DEVICE, description: 'Autoselect device' }
  return [auto, ...devices.filter((device) => device.name !== AUTO_AUDIO_DEVICE)]
}

/**
 * Pure. Picks the audio device to actually apply on restore. If the stored
 * preference is `'auto'` (always valid) or is still present in `devices`, it's
 * used as-is; otherwise the device was unplugged/renamed, so fall back to
 * `'auto'` for this session — the caller keeps the stored preference so it
 * takes effect again if the device reappears.
 */
export function effectiveAudioDevice(stored: string, devices: AudioDevice[]): string {
  if (stored === AUTO_AUDIO_DEVICE) return AUTO_AUDIO_DEVICE
  return devices.some((device) => device.name === stored) ? stored : AUTO_AUDIO_DEVICE
}
