/** An mpv `audio-device-list` entry. */
export interface AudioDevice {
  name: string
  description: string
}

/** The special device meaning "let mpv follow the OS default output". */
export const AUTO_AUDIO_DEVICE = 'auto'

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

/** Keep the OS-default option available before mpv returns a device list. */
export function audioDeviceMenuList(devices: AudioDevice[]): AudioDevice[] {
  const auto: AudioDevice = { name: AUTO_AUDIO_DEVICE, description: 'Autoselect device' }
  return [auto, ...devices.filter((device) => device.name !== AUTO_AUDIO_DEVICE)]
}

/** Fall back for this session only; retain the stored preference in case the device returns. */
export function effectiveAudioDevice(stored: string, devices: AudioDevice[]): string {
  if (stored === AUTO_AUDIO_DEVICE) return AUTO_AUDIO_DEVICE
  return devices.some((device) => device.name === stored) ? stored : AUTO_AUDIO_DEVICE
}
