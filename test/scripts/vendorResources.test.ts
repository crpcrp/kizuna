import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  SUPPORTED_PLATFORM_KEYS,
  SUPPORTED_SCHEMA_VERSION,
  acquireResources,
  lockProblems,
  missingRequiredPaths,
  parseChecksums,
  platformKeyFor,
  stageResources,
  stagedResourceProblems,
  verificationError,
  verifyVendorFiles,
  vendorFetchSteps
} from '@scripts/vendorResources.mjs'

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const COMMIT = 'a'.repeat(40)

const MIRROR_FILES: Record<string, string> = {
  'mpv/bin/mpv.exe': 'windows-mpv',
  'mpv/LICENSE.GPLv3.txt': 'windows-mpv-license',
  'mecab/bin/mecab.exe': 'windows-mecab',
  'mecab/etc/mecabrc': 'windows-mecabrc',
  'mecab/ipadic/sys.dic': 'windows-dictionary',
  'linux-x64/mpv/bin/mpv': 'linux-mpv',
  'linux-x64/mpv/licenses/COPYRIGHT.Ubuntu': 'linux-mpv-license',
  'linux-x64/ffmpeg/bin/ffmpeg': 'linux-ffmpeg',
  'linux-x64/ffmpeg/bin/ffprobe': 'linux-ffprobe',
  'linux-x64/mecab/bin/mecab': 'linux-mecab-wrapper',
  'linux-x64/mecab/bin/mecab.bin': 'linux-mecab',
  'linux-x64/mecab/etc/mecabrc': 'linux-mecabrc',
  'linux-x64/mecab/ipadic/sys.dic': 'linux-dictionary',
  'linux-x64/mecab/lib/libmecab.so.2': 'linux-library'
}

const source = {
  repo: 'crpcrp/kizuna-vendor',
  commit: COMMIT,
  manifest: 'manifest.json',
  checksums: 'SHA256SUMS.txt'
}

const linuxDestination = (from: string): string => {
  const relative = from.slice('linux-x64/'.length)
  if (relative.startsWith('mpv/bin/')) return 'mpv/' + relative.slice('mpv/bin/'.length)
  if (relative.startsWith('ffmpeg/bin/')) return 'ffmpeg/' + relative.slice('ffmpeg/bin/'.length)
  if (relative.startsWith('mecab/bin/')) return 'mecab/' + relative.slice('mecab/bin/'.length)
  if (relative.startsWith('mecab/etc/')) return 'mecab/' + relative.slice('mecab/etc/'.length)
  return relative
}

const entry = (from: string, to: string, executable: boolean) => ({
  from,
  to,
  sha256: sha256(MIRROR_FILES[from]),
  executable
})

const LOCK = {
  schemaVersion: SUPPORTED_SCHEMA_VERSION,
  platforms: {
    'win32-x64': {
      platform: 'win32',
      architecture: 'x64',
      source,
      requiredPaths: ['mpv/mpv.exe', 'mecab/mecab.exe', 'mecab/mecabrc', 'mecab/ipadic/sys.dic'],
      requiredExecutables: ['mpv/mpv.exe', 'mecab/mecab.exe'],
      files: [
        entry('mpv/bin/mpv.exe', 'mpv/mpv.exe', true),
        entry('mpv/LICENSE.GPLv3.txt', 'mpv/LICENSE.GPLv3.txt', false),
        entry('mecab/bin/mecab.exe', 'mecab/mecab.exe', true),
        entry('mecab/etc/mecabrc', 'mecab/mecabrc', false),
        entry('mecab/ipadic/sys.dic', 'mecab/ipadic/sys.dic', false)
      ]
    },
    'linux-x64': {
      platform: 'linux',
      architecture: 'x64',
      source,
      requiredPaths: [
        'mpv/mpv',
        'ffmpeg/ffmpeg',
        'ffmpeg/ffprobe',
        'mecab/mecab',
        'mecab/mecab.bin',
        'mecab/mecabrc',
        'mecab/lib/libmecab.so.2',
        'mecab/ipadic/sys.dic'
      ],
      requiredExecutables: [
        'mpv/mpv',
        'ffmpeg/ffmpeg',
        'ffmpeg/ffprobe',
        'mecab/mecab',
        'mecab/mecab.bin'
      ],
      files: Object.keys(MIRROR_FILES)
        .filter((path) => path.startsWith('linux-x64/'))
        .map((path) =>
          entry(
            path,
            linuxDestination(path),
            path.endsWith('/mpv') ||
              path.endsWith('/ffmpeg') ||
              path.endsWith('/ffprobe') ||
              path.endsWith('/mecab') ||
              path.endsWith('/mecab.bin')
          )
        )
    }
  }
}

type MutableLock = {
  platforms: Record<
    string,
    {
      source: { commit: string }
      files: { from: string; to: string; sha256: string; executable: boolean }[]
    }
  >
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const mutableLock = (): MutableLock => copy(LOCK) as unknown as MutableLock

async function makeMirror() {
  const root = await mkdtemp(join(tmpdir(), 'kizuna-vendor-'))
  const vendorDir = join(root, 'mirror')
  const resourcesDir = join(root, 'resources')
  for (const [path, contents] of Object.entries(MIRROR_FILES)) {
    const full = join(vendorDir, path)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, contents)
  }
  const payload = (
    platform: string,
    architecture: string,
    prefix: string,
    licenseFiles: string[]
  ) => ({
    platform,
    architecture,
    components: [
      {
        name: platform,
        files: Object.keys(MIRROR_FILES)
          .filter((path) => path.startsWith(prefix))
          .map((path) => ({ path, sha256: sha256(MIRROR_FILES[path]) })),
        licenseFiles
      }
    ]
  })
  await writeFile(
    join(vendorDir, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 2,
        payloads: [
          payload('win32', 'x64', 'mpv/', ['mpv/LICENSE.GPLv3.txt']),
          payload('linux', 'x64', 'linux-x64/', ['linux-x64/mpv/licenses/COPYRIGHT.Ubuntu'])
        ]
      },
      null,
      2
    )
  )
  const checksums = Object.entries(MIRROR_FILES)
    .map(([path, contents]) => sha256(contents) + '  ' + path)
    .join('\n')
  await writeFile(join(vendorDir, 'SHA256SUMS.txt'), checksums + '\n')
  return { root, vendorDir, resourcesDir }
}

describe('platform selection and lock validation', () => {
  it('maps supported host pairs and rejects unknown combinations', () => {
    expect(platformKeyFor('win32', 'x64')).toBe('win32-x64')
    expect(platformKeyFor('linux', 'x64')).toBe('linux-x64')
    expect(() => platformKeyFor('linux', 'arm64')).toThrow(/Supported targets/)
  })

  it('accepts both explicit platform entries', () => {
    expect(SUPPORTED_PLATFORM_KEYS).toEqual(['win32-x64', 'linux-x64'])
    expect(lockProblems(LOCK)).toEqual([])
  })

  it('rejects unknown keys, missing hashes, unsafe paths, duplicate destinations, and mismatched pins', () => {
    const unknownLock = mutableLock()
    unknownLock.platforms['darwin-x64'] = copy(unknownLock.platforms['win32-x64'])
    expect(lockProblems(unknownLock).join('\n')).toContain('unknown key darwin-x64')

    const unhashed = mutableLock()
    unhashed.platforms['win32-x64'].files[0].sha256 = ''
    expect(lockProblems(unhashed).join('\n')).toContain('has no valid sha256')

    const unsafe = mutableLock()
    unsafe.platforms['linux-x64'].files[0].to = '../outside'
    expect(lockProblems(unsafe).join('\n')).toContain('unsafe to path')

    const duplicate = mutableLock()
    duplicate.platforms['win32-x64'].files.push({
      ...duplicate.platforms['win32-x64'].files[0],
      from: 'other/file'
    })
    expect(lockProblems(duplicate).join('\n')).toContain('duplicate destination')

    const mismatched = mutableLock()
    mismatched.platforms['linux-x64'].source.commit = 'b'.repeat(40)
    expect(lockProblems(mismatched).join('\n')).toContain('same immutable vendor commit')
  })

  // Game OCR runs on Windows only, so its PaddleOCR runtime must never enter
  // the Linux tree: staging it there would add a large payload that the Linux
  // application can never run.
  it('keeps the Game OCR payload out of the Linux entry', () => {
    const leaked = mutableLock()
    leaked.platforms['linux-x64'].files.push({
      from: 'linux-x64/mpv/bin/mpv',
      to: 'paddleocr/paddleocr.exe',
      sha256: 'c'.repeat(64),
      executable: true
    })
    expect(lockProblems(leaked).join('\n')).toContain(
      'stages paddleocr/paddleocr.exe, which only win32-x64 may ship'
    )

    const windows = mutableLock()
    windows.platforms['win32-x64'].files.push({
      from: 'paddleocr/paddleocr.exe',
      to: 'paddleocr/paddleocr.exe',
      sha256: 'c'.repeat(64),
      executable: true
    })
    expect(lockProblems(windows)).toEqual([])
  })
})

describe('checksums and acquisition', () => {
  it('parses text and binary checksum records', () => {
    expect(parseChecksums('a'.repeat(64) + '  a\n' + 'b'.repeat(64) + ' *b\n')).toEqual({
      a: 'a'.repeat(64),
      b: 'b'.repeat(64)
    })
  })

  it('pins the checkout, disables line-ending conversion, and pulls LFS after checkout', () => {
    const steps = vendorFetchSteps({ url: 'https://example.test/vendor.git', commit: COMMIT })
    expect(steps.map((step) => step.argv)).toContainEqual([
      'fetch',
      '--depth',
      '1',
      '--no-tags',
      'origin',
      COMMIT
    ])
    expect(steps.map((step) => step.argv)).toContainEqual(['config', 'core.autocrlf', 'false'])
    expect(steps.map((step) => step.argv)).toContainEqual(['config', 'core.eol', 'lf'])
    expect(steps[steps.length - 1].argv).toEqual(['lfs', 'pull'])
  })

  it('verifies both the lock hashes and the selected manifest payload', async () => {
    const { vendorDir } = await makeMirror()
    for (const platformKey of SUPPORTED_PLATFORM_KEYS) {
      const result = await verifyVendorFiles({ lock: LOCK, platformKey, vendorDir })
      expect(result).toEqual({
        missing: [],
        mismatched: [],
        lfsPointers: [],
        metadataProblems: []
      })
    }
  })

  it('reports a Git LFS pointer with an actionable error', async () => {
    const { vendorDir } = await makeMirror()
    await writeFile(
      join(vendorDir, 'linux-x64/mpv/bin/mpv'),
      'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'd'.repeat(64) + '\nsize 12\n'
    )
    const result = await verifyVendorFiles({ lock: LOCK, platformKey: 'linux-x64', vendorDir })
    expect(result.lfsPointers).toEqual(['linux-x64/mpv/bin/mpv'])
    expect(verificationError(result, COMMIT)).toContain('git lfs pull')
  })

  it('fails closed when the selected manifest has the wrong platform', async () => {
    const { vendorDir } = await makeMirror()
    await writeFile(
      join(vendorDir, 'manifest.json'),
      JSON.stringify({ schemaVersion: 2, payloads: [{ platform: 'win32', architecture: 'x64' }] })
    )
    const result = await verifyVendorFiles({ lock: LOCK, platformKey: 'linux-x64', vendorDir })
    expect(verificationError(result, COMMIT)).toContain('manifest has no payload for linux-x64')
  })
})

describe('resource staging', () => {
  it('maps logical paths, preserves selected files, and removes the other platform', async () => {
    const { vendorDir, resourcesDir } = await makeMirror()
    await stageResources({ lock: LOCK, platformKey: 'win32-x64', vendorDir, resourcesDir })
    await expect(stat(join(resourcesDir, 'mpv/mpv.exe'))).resolves.toBeTruthy()

    await stageResources({ lock: LOCK, platformKey: 'linux-x64', vendorDir, resourcesDir })
    await expect(stat(join(resourcesDir, 'mpv/mpv'))).resolves.toBeTruthy()
    await expect(stat(join(resourcesDir, 'mpv/mpv.exe'))).rejects.toThrow()
    expect(
      await stagedResourceProblems({ lock: LOCK, platformKey: 'linux-x64', resourcesDir })
    ).toEqual([])
  })

  it('is idempotent and reports missing required paths', async () => {
    const { vendorDir, resourcesDir } = await makeMirror()
    const first = await stageResources({
      lock: LOCK,
      platformKey: 'win32-x64',
      vendorDir,
      resourcesDir
    })
    const second = await stageResources({
      lock: LOCK,
      platformKey: 'win32-x64',
      vendorDir,
      resourcesDir
    })
    expect(first.copied).toHaveLength(5)
    expect(second.copied).toEqual([])
    expect(second.skipped).toHaveLength(5)

    await expect(
      missingRequiredPaths({ lock: LOCK, platformKey: 'linux-x64', resourcesDir })
    ).resolves.toEqual(expect.arrayContaining(['mpv/mpv', 'mecab/mecab']))
  })

  it('rejects a staged file whose contents drift from the lock', async () => {
    const { vendorDir, resourcesDir } = await makeMirror()
    await stageResources({ lock: LOCK, platformKey: 'linux-x64', vendorDir, resourcesDir })
    await writeFile(join(resourcesDir, 'mpv/mpv'), 'tampered after staging')

    await expect(
      stagedResourceProblems({ lock: LOCK, platformKey: 'linux-x64', resourcesDir })
    ).resolves.toEqual(
      expect.arrayContaining([expect.stringContaining('staged resource hash mismatch: mpv/mpv')])
    )
  })
})

describe('acquireResources', () => {
  it('materialises, verifies, stages, and returns a report', async () => {
    const { vendorDir, resourcesDir } = await makeMirror()
    const seen: string[][] = []
    const report = await acquireResources({
      lock: LOCK,
      platformKey: 'linux-x64',
      vendorDir,
      resourcesDir,
      materialize: async (steps) => {
        for (const step of steps) seen.push(step.argv)
      }
    })
    expect(report.copied).toHaveLength(9)
    expect(seen).toContainEqual([
      'remote',
      'add',
      'origin',
      'https://github.com/crpcrp/kizuna-vendor.git'
    ])
  })

  it('refuses a malformed lock before materialization', async () => {
    const { vendorDir, resourcesDir } = await makeMirror()
    const malformed = copy(LOCK)
    malformed.platforms['linux-x64'].source.commit = 'main'
    let materialized = false
    await expect(
      acquireResources({
        lock: malformed,
        platformKey: 'linux-x64',
        vendorDir,
        resourcesDir,
        materialize: async () => {
          materialized = true
        }
      })
    ).rejects.toThrow('resources.lock.json is unusable')
    expect(materialized).toBe(false)
  })
})
