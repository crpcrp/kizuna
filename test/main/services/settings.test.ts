import disk from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  defaultSettings,
  mergeSettings,
  selectDict,
  createSettingsStore,
  type Settings
} from '@src/main/services/settings'
import { createSettingsFile } from '@src/main/services/settingsFile'
import { fakeIo } from '@test/harness/fakeSettingsIo'
// Synthetic non-default settings serialized with the v0.5.0 mergeSettings implementation.
import releasedSettings from '@test/fixtures/v0.5.0/settings.json'

const tempDirs: string[] = []
function tempDir(): string {
  const dir = disk.mkdtempSync(join(tmpdir(), 'kizuna-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) disk.rmSync(dir, { recursive: true, force: true })
})

function withField(source: unknown, path: string, value: unknown): Record<string, unknown> {
  const result = structuredClone(source) as Record<string, unknown>
  const keys = path.split('.')
  let target = result
  for (const key of keys.slice(0, -1)) {
    target = (target[key] ??= {}) as Record<string, unknown>
  }
  target[keys.at(-1)!] = value
  return result
}

const malformed = [undefined, null, 42, 'invalid', [], {}]
const booleanCases = [undefined, null, 'yes', 'no', 0, 1, [], {}]
const positiveCases = [undefined, null, 'ten', 0, -5, NaN, Infinity]
const stringCases = [undefined, null, 42, [], {}]

const fields: [string, unknown, unknown[]][] = [
  ['mecabDictId', 'unidic', malformed],
  ['dictOrder', [3, 1, 2], [undefined, null, 'nope', ['a', 'b']]],
  ['translation.azureSubscriptionKeyEnc', 'encrypted-key', stringCases],
  ['translation.azureRegion', 'eastus', stringCases],
  ['jimaku.apiKeyEnc', 'encrypted-key', stringCases],
  ['gameOcr.captureShortcut', 'Alt+O', [...malformed, 'Alt', 'KeyO', 'Ctrl+Shift']],
  ['updates.checkAutomatically', false, booleanCases],
  ['knowledge.wanikaniTokenEnc', 'encrypted-token', stringCases],
  ['knowledge.ankiKnownDecks', ['Japanese', 'Core 2k'], [undefined, null, 'Japanese', [1, 2]]],
  ['knowledge.ankiKnownField', 'Expression', stringCases],
  ['knowledge.knownIntervalDays', 30, positiveCases],
  ['knowledge.wellKnownIntervalDays', 60, positiveCases],
  ['knowledge.staleAfterHours', 0, [undefined, null, 'never', -1, NaN, Infinity]],
  ['knowledge.coloringEnabled', false, booleanCases],
  ['anki.url', 'http://localhost:9999', stringCases],
  ['anki.apiKey', 'secret', stringCases],
  ['anki.deckName', 'Japanese', stringCases],
  ['anki.modelName', 'Basic', stringCases],
  ['anki.tags', ['kizuna', 'mined'], [undefined, null, 'tag', ['ok', 42]]],
  ['anki.includeWordAudio', false, booleanCases],
  ...['prevent-global', 'prevent-deck', 'overwrite', 'allow'].map(
    (value): [string, unknown, unknown[]] => ['anki.duplicatePolicy', value, malformed]
  ),
  ...Object.keys(defaultSettings.anki.fieldMap).map((key): [string, unknown, unknown[]] => [
    `anki.fieldMap.${key}`,
    'Field',
    stringCases
  ]),
  ...['splash', 'game-ocr', 'video-player'].map((value): [string, unknown, unknown[]] => [
    'player.startupBehavior',
    value,
    [...malformed, 'ocr', '']
  ]),
  ['player.skipSeconds', 10, positiveCases],
  ['player.keyBindings.togglePause', 'KeyK', [undefined, null, 123, 'Ctrl+']],
  ['player.keyBindings.skipBack', 'ControlLeft+ArrowLeft', ['AltLeft+ArrowRight']],
  ['player.popupSettings.maxEntries', 8, [undefined, null, 'eight']],
  ['player.subtitleStyle.fontScale', 1.5, [undefined, null, 'large']],
  ...['off', 'before', 'after'].map((value): [string, unknown, unknown[]] => [
    'player.subtitleAutoPauseTiming',
    value,
    [...malformed, 'Before']
  ]),
  ...['all', 'unknown'].map((value): [string, unknown, unknown[]] => [
    'player.subtitleAutoPauseScope',
    value,
    [...malformed, 'Unknown']
  ]),
  ...['system', 'light', 'dark'].map((value): [string, unknown, unknown[]] => [
    'player.appearance',
    value,
    [...malformed, 'blue']
  ]),
  ['player.subtitleDragEnabled', false, booleanCases],
  ['player.rightClickTogglePause', false, booleanCases],
  ['player.autoPlayNext', true, booleanCases],
  ['player.sidebarOpen', true, booleanCases],
  ['player.playlistOpen', true, booleanCases],
  ['player.translationEnabled', true, booleanCases],
  ['player.mpvUserConfig', true, booleanCases],
  ['player.loudnessNormalization', true, booleanCases],
  ['player.screenshotFolder', 'E:\\Caps', [...stringCases, '', '   ']],
  ['player.mpvExtraArgs', ['--hwdec=auto'], [undefined, null, '--hwdec=auto', 42]],
  ['player.audioDevice', 'coreaudio/1', [...stringCases, '']],
  ['player.levelColors', { unknown: '#123abc' }, malformed],
  [
    'player.videoAdjustments',
    { ...defaultSettings.player.videoAdjustments, brightness: 20 },
    malformed
  ],
  ...['subtitleOffsets', 'folderSubtitleOffsets', 'audioDelays'].map(
    (key): [string, unknown, unknown[]] => [
      `player.${key}`,
      { '/videos/a.mkv': 250, '/videos/b.mkv': -100 },
      malformed
    ]
  )
]

describe('settings normalization', () => {
  it.each([undefined, null, 'not-an-object', 42, [1, 2, 3]])('defaults invalid root %j', (raw) => {
    expect(mergeSettings(raw)).toEqual(defaultSettings)
  })
  it.each(['anki', 'knowledge', 'updates', 'player', 'gameOcr', 'translation', 'jimaku'])(
    'defaults a malformed %s block',
    (domain) => {
      for (const value of malformed) {
        expect(mergeSettings({ [domain]: value })).toEqual(defaultSettings)
      }
    }
  )
  it.each(fields)(
    '%s round-trips valid values and defaults malformed ones',
    (path, valid, invalid) => {
      const expected = withField(defaultSettings, path, valid)
      const io = fakeIo(JSON.stringify(withField({}, path, valid)))
      const store = createSettingsStore(io)
      expect(store.get()).toEqual(expected)
      store.set({})
      expect(createSettingsStore(io).get()).toEqual(expected)
      for (const value of invalid) {
        expect(mergeSettings(withField({ mecabDictId: 'unidic' }, path, value))).toEqual(
          path === 'mecabDictId' ? defaultSettings : { ...defaultSettings, mecabDictId: 'unidic' }
        )
      }
    }
  )

  it.each([
    ['translation.azureRegion', '  eastus  ', 'eastus'],
    [
      'player.mpvExtraArgs',
      ['  --vo=gpu  ', '', 42, '--sub-scale=2'],
      ['--vo=gpu', '--sub-scale=2']
    ],
    [
      'player.levelColors',
      { learning: '#E0A83C', wellKnown: '#AABBCC', known: 'nope' },
      { learning: '#e0a83c', wellKnown: '#aabbcc' }
    ],
    [
      'player.videoAdjustments',
      { brightness: 500, contrast: 'x', saturation: 10, rotate: 45, deinterlace: 'no' },
      { ...defaultSettings.player.videoAdjustments, brightness: 100, saturation: 10 }
    ],
    ...['subtitleOffsets', 'folderSubtitleOffsets', 'audioDelays'].map((key) => [
      `player.${key}`,
      { '/valid': 250, '/bad': 'nope', '/worse': Infinity },
      { '/valid': 250 }
    ])
  ] as [string, unknown, unknown][])('normalizes %s field by field', (path, raw, expected) => {
    expect(mergeSettings(withField({}, path, raw))).toEqual(
      withField(defaultSettings, path, expected)
    )
  })

  it('loads and rewrites settings emitted by v0.5.0 without changing values', () => {
    const io = fakeIo(JSON.stringify(releasedSettings))
    const store = createSettingsStore(io, { platform: 'posix' })
    expect(store.get()).toEqual(releasedSettings)
    store.set({})
    expect(JSON.parse(io.read()!)).toEqual(releasedSettings)
    expect(createSettingsStore(io, { platform: 'posix' }).get()).toEqual(releasedSettings)
  })

  it('discards unknown fields while preserving supported settings', () => {
    const io = fakeIo(
      JSON.stringify({
        mediaHistory: { recentFiles: [] },
        player: {
          volumeBoostEnabled: true,
          onlineSubtitleLanguage: 'ja',
          audioDevice: 'coreaudio/1'
        },
        gameOcr: { captureShortcut: 'Alt+O', armed: true },
        anki: { includeScreenshot: false, fieldMap: { unknown: 'Unknown', word: 'Expression' } }
      })
    )
    const store = createSettingsStore(io)
    store.set({ dictOrder: [1] })
    expect(JSON.parse(io.read()!)).toEqual({
      ...defaultSettings,
      dictOrder: [1],
      player: { ...defaultSettings.player, audioDevice: 'coreaudio/1' },
      gameOcr: { captureShortcut: 'Alt+O' },
      anki: {
        ...defaultSettings.anki,
        fieldMap: { ...defaultSettings.anki.fieldMap, word: 'Expression' }
      }
    })
  })
})

describe('Jimaku folder hints', () => {
  it('normalizes folder hints, drops malformed records, and keeps season keys aligned', () => {
    const valid = {
      entryId: 7,
      name: 'Show',
      category: 'anime',
      season: 2,
      updatedAt: 12
    }
    const merged = mergeSettings(
      {
        jimaku: {
          folderHints: {
            '/media/Show\u00002': valid,
            '/media/mismatch\u00002': { ...valid, season: 1 },
            '/media/bad\u0000x': valid,
            '/media/invalid': { ...valid, entryId: 0 },
            '/media/too-long': { ...valid, name: 'x'.repeat(513) }
          }
        }
      },
      { platform: 'posix' }
    )

    expect(merged.jimaku.folderHints).toEqual({ '/media/Show\u00002': valid })
  })

  it('prunes folder hints to the 100 most recent entries deterministically', () => {
    const folderHints: Record<string, unknown> = {}
    for (let index = 0; index < 102; index++) {
      const folder = `/media/folder-${String(index).padStart(3, '0')}`
      folderHints[folder] = {
        entryId: index + 1,
        name: `Show ${index}`,
        category: 'anime',
        updatedAt: index
      }
    }

    const merged = mergeSettings({ jimaku: { folderHints } }, { platform: 'posix' })
    const keys = Object.keys(merged.jimaku.folderHints)
    expect(keys).toHaveLength(100)
    expect(merged.jimaku.folderHints['/media/folder-000']).toBeUndefined()
    expect(merged.jimaku.folderHints['/media/folder-001']).toBeUndefined()
    expect(merged.jimaku.folderHints['/media/folder-002']).toMatchObject({ entryId: 3 })
  })
})

describe('selectDict', () => {
  it.each([
    ['ipadic', ['ipadic', 'unidic'], 'ipadic'],
    ['unidic', ['ipadic', 'unidic'], 'unidic'],
    ['unidic', ['ipadic'], 'ipadic'],
    ['ipadic', [], 'ipadic']
  ] as const)('selects %s from %j', (id, available, expected) => {
    expect(selectDict(id, [...available])).toBe(expected)
  })
})

describe('createSettingsStore', () => {
  it('reads undefined io as defaults', () => {
    const store = createSettingsStore(fakeIo(undefined))
    expect(store.get()).toEqual(defaultSettings)
  })

  it('parses+merges whatever was persisted at construction', () => {
    const store = createSettingsStore(fakeIo(JSON.stringify({ mecabDictId: 'unidic' })))
    expect(store.get()).toEqual({ ...defaultSettings, mecabDictId: 'unidic' })
  })

  it('round-trips a set() through io.write then a fresh store via io.read()', () => {
    const io = fakeIo(undefined)
    const store = createSettingsStore(io)
    const updated: Settings = store.set({ mecabDictId: 'unidic', dictOrder: [2, 1] })
    expect(updated).toEqual({ ...defaultSettings, mecabDictId: 'unidic', dictOrder: [2, 1] })

    // Simulate reopening the app: a fresh store reads the same io and must
    // see the persisted value.
    const reopened = createSettingsStore(io)
    expect(reopened.get()).toEqual({ ...defaultSettings, mecabDictId: 'unidic', dictOrder: [2, 1] })
  })

  it('round-trips the Game OCR shortcut without persisting runtime state', () => {
    const io = fakeIo(undefined)
    const store = createSettingsStore(io)
    store.set({ gameOcr: { captureShortcut: 'Alt+O' } })

    expect(createSettingsStore(io).get().gameOcr).toEqual({ captureShortcut: 'Alt+O' })
    expect(io.read()).not.toContain('armed')
  })

  it('tolerates garbage JSON already on disk', () => {
    const store = createSettingsStore(fakeIo('{not valid json'))
    expect(store.get()).toEqual(defaultSettings)
  })

  it('keeps a failed write in memory, reports it once, and retries', () => {
    const failure = new Error('EPERM')
    let fail = true
    const written: string[] = []
    const onWriteError = vi.fn()
    const store = createSettingsStore(
      {
        read: () => undefined,
        write: (text) => {
          if (fail) throw failure
          written.push(text)
        }
      },
      { onWriteError }
    )

    expect(store.set({ mecabDictId: 'unidic' }).mecabDictId).toBe('unidic')
    expect(store.get().mecabDictId).toBe('unidic')
    expect(store.hasPendingWrite()).toBe(true)
    store.set({ dictOrder: [2] })
    expect(store.flush()).toBe(false)
    expect(onWriteError).toHaveBeenCalledExactlyOnceWith(failure)

    fail = false
    store.set({ dictOrder: [3] })
    expect(store.hasPendingWrite()).toBe(false)
    expect(JSON.parse(written[0])).toMatchObject({ mecabDictId: 'unidic', dictOrder: [3] })
    expect(store.flush()).toBe(true)
    expect(written).toHaveLength(1)
  })

  it('flush retries a pending write without a new set', () => {
    let fail = true
    const written: string[] = []
    const store = createSettingsStore(
      {
        read: () => undefined,
        write: (text) => {
          if (fail) throw new Error('EBUSY')
          written.push(text)
        }
      },
      { onWriteError: () => {} }
    )
    store.set({ mecabDictId: 'unidic' })
    fail = false

    expect(store.flush()).toBe(true)
    expect(JSON.parse(written[0]).mecabDictId).toBe('unidic')
  })
})

describe('createSettingsFile', () => {
  it('reads a missing file as absent and atomically replaces existing settings', () => {
    const path = join(tempDir(), 'settings.json')
    const file = createSettingsFile(path)
    expect(file.read()).toBeUndefined()
    disk.writeFileSync(path, 'previous')
    file.write('next')
    expect(file.read()).toBe('next')
    expect(disk.existsSync(`${path}.tmp`)).toBe(false)
  })

  it.each(['writeFileSync', 'renameSync'] as const)(
    'preserves settings and cleans temp after %s fails',
    (method) => {
      const path = join(tempDir(), 'settings.json')
      disk.writeFileSync(path, 'previous')
      vi.spyOn(disk, method).mockImplementationOnce(() => {
        throw new Error('disk failure')
      })
      expect(() => createSettingsFile(path).write('next')).toThrow('disk failure')
      expect(disk.readFileSync(path, 'utf-8')).toBe('previous')
      expect(disk.existsSync(`${path}.tmp`)).toBe(false)
    }
  )

  it('preserves the primary error when cleanup fails too', () => {
    const path = join(tempDir(), 'settings.json')
    vi.spyOn(disk, 'writeFileSync').mockImplementationOnce(() => {
      throw new Error('write failed')
    })
    vi.spyOn(disk, 'unlinkSync').mockImplementationOnce(() => {
      throw new Error('unlink failed')
    })
    expect(() => createSettingsFile(path).write('next')).toThrow('write failed')
  })
})
