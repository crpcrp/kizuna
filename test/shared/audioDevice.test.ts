import { describe, it, expect } from 'vitest'
import {
  AUTO_AUDIO_DEVICE,
  audioDeviceMenuList,
  effectiveAudioDevice,
  parseAudioDeviceList,
  type AudioDevice
} from '@src/shared/audioDevice'

describe('audioDeviceMenuList', () => {
  it('always leads with a single auto entry', () => {
    expect(audioDeviceMenuList([])).toEqual([{ name: 'auto', description: 'Autoselect device' }])
  })

  it('keeps mpv devices after auto and de-dupes an mpv-supplied auto', () => {
    const devices: AudioDevice[] = [
      { name: 'auto', description: 'Autoselect device' },
      { name: 'wasapi/{abc}', description: 'Speakers' }
    ]
    expect(audioDeviceMenuList(devices)).toEqual([
      { name: 'auto', description: 'Autoselect device' },
      { name: 'wasapi/{abc}', description: 'Speakers' }
    ])
  })
})

describe('parseAudioDeviceList', () => {
  it('keeps well-formed { name, description } entries', () => {
    expect(
      parseAudioDeviceList([
        { name: 'auto', description: 'Autoselect device' },
        { name: 'wasapi/{abc}', description: 'Speakers (Realtek)' }
      ])
    ).toEqual([
      { name: 'auto', description: 'Autoselect device' },
      { name: 'wasapi/{abc}', description: 'Speakers (Realtek)' }
    ])
  })

  it('falls back to the name when the description is missing or blank', () => {
    expect(
      parseAudioDeviceList([{ name: 'coreaudio/1' }, { name: 'coreaudio/2', description: '' }])
    ).toEqual([
      { name: 'coreaudio/1', description: 'coreaudio/1' },
      { name: 'coreaudio/2', description: 'coreaudio/2' }
    ])
  })

  it('returns [] for a non-array payload', () => {
    expect(parseAudioDeviceList(null)).toEqual([])
    expect(parseAudioDeviceList(undefined)).toEqual([])
    expect(parseAudioDeviceList('auto')).toEqual([])
    expect(parseAudioDeviceList({ name: 'auto' })).toEqual([])
  })

  it('drops entries that are not objects or lack a usable name', () => {
    expect(
      parseAudioDeviceList([
        null,
        'garbage',
        42,
        { description: 'no name' },
        { name: '' },
        { name: 'ok' }
      ])
    ).toEqual([{ name: 'ok', description: 'ok' }])
  })
})

describe('effectiveAudioDevice', () => {
  const devices: AudioDevice[] = [
    { name: 'auto', description: 'Autoselect device' },
    { name: 'wasapi/{abc}', description: 'Speakers' }
  ]

  it('always accepts auto', () => {
    expect(effectiveAudioDevice(AUTO_AUDIO_DEVICE, [])).toBe('auto')
    expect(effectiveAudioDevice('auto', devices)).toBe('auto')
  })

  it('keeps a stored device that is still present in the list', () => {
    expect(effectiveAudioDevice('wasapi/{abc}', devices)).toBe('wasapi/{abc}')
  })

  it('falls back to auto when the stored device is no longer present (unplugged)', () => {
    expect(effectiveAudioDevice('wasapi/{gone}', devices)).toBe('auto')
    expect(effectiveAudioDevice('headphones', [])).toBe('auto')
  })
})
