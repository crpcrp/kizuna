import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '@test/paths'

import { parsePlatformArg, parseVendorDirArg } from '@scripts/fetch-resources.mjs'
import { lockProblems, vendorRemoteUrl } from '@scripts/vendorResources.mjs'

describe('fetch-resources arguments', () => {
  it('reads vendor directory and platform overrides in separated and inline forms', () => {
    expect(parseVendorDirArg(['--vendor-dir', 'D:/kizuna-vendor'])).toBe('D:/kizuna-vendor')
    expect(parseVendorDirArg(['--vendor-dir=D:/a=b'])).toBe('D:/a=b')
    expect(parsePlatformArg(['--platform', 'linux-x64'])).toBe('linux-x64')
    expect(parsePlatformArg(['--platform=win32-x64'])).toBe('win32-x64')
  })

  it('returns undefined when either flag is absent', () => {
    expect(parseVendorDirArg(['--verbose'])).toBeUndefined()
    expect(parsePlatformArg(['--verbose'])).toBeUndefined()
  })
})

describe('resources.lock.json', () => {
  type PlatformEntry = {
    source: { repo: string; commit: string; manifest: string; checksums: string }
    requiredExecutables: string[]
    files: { from: string; to: string; executable: boolean }[]
  }
  const lock = JSON.parse(readFileSync(join(REPO_ROOT, 'resources.lock.json'), 'utf-8')) as {
    platforms: Record<string, PlatformEntry>
  }

  it('passes the same validation the fetch script applies', () => {
    expect(lockProblems(lock)).toEqual([])
  })

  it('contains both platform maps with executable and dictionary coverage', () => {
    expect(Object.keys(lock.platforms).sort()).toEqual(['linux-x64', 'win32-x64'])
    expect(lock.platforms['win32-x64'].requiredExecutables).toEqual(
      expect.arrayContaining(['mpv/mpv.exe', 'ffmpeg/ffprobe.exe', 'mecab/mecab.exe'])
    )
    expect(lock.platforms['linux-x64'].requiredExecutables).toEqual(
      expect.arrayContaining(['mpv/mpv', 'ffmpeg/ffprobe', 'mecab/bin/mecab.bin'])
    )
    expect(lock.platforms['linux-x64'].files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'linux-x64/mecab/bin/mecab', to: 'mecab/bin/mecab' }),
        expect.objectContaining({ from: 'linux-x64/mecab/lib/libmecab.so.2', executable: false })
      ])
    )
  })

  it('pins both entries to the same vendor repository and commit', () => {
    const entries = Object.values(lock.platforms)
    expect(new Set(entries.map((entry) => entry.source.repo))).toEqual(
      new Set(['crpcrp/kizuna-vendor'])
    )
    expect(new Set(entries.map((entry) => entry.source.commit)).size).toBe(1)
    for (const entry of entries) {
      expect(entry.source.manifest).toBe('manifest.json')
      expect(entry.source.checksums).toBe('SHA256SUMS.txt')
    }
    expect(vendorRemoteUrl(entries[0].source.repo)).toBe(
      'https://github.com/crpcrp/kizuna-vendor.git'
    )
  })

  it('carries license files in each selected platform tree', () => {
    const paths = (entry: PlatformEntry) => entry.files.map((file) => file.to)
    expect(paths(lock.platforms['win32-x64'])).toEqual(
      expect.arrayContaining(['mpv/Copyright', 'ffmpeg/LICENSE.GPLv3.txt', 'mecab/ipadic/COPYING'])
    )
    expect(paths(lock.platforms['linux-x64'])).toEqual(
      expect.arrayContaining([
        'mpv/licenses/COPYRIGHT.Ubuntu',
        'ffmpeg/licenses/GPL-3.txt',
        'mecab/licenses/COPYRIGHT.IPADIC-Ubuntu'
      ])
    )
  })
})
