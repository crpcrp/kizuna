import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '@test/paths'

import { parseVendorDirArg } from '@scripts/fetch-resources.mjs'
import { lockProblems, vendorRemoteUrl } from '@scripts/vendorResources.mjs'

// Importing the CLI must not start a download — the module only calls `main()`
// when `process.argv[1]` is the script itself, and this suite proves the guard
// holds by simply completing.

describe('parseVendorDirArg', () => {
  it('reads the separated form', () => {
    expect(parseVendorDirArg(['--vendor-dir', 'D:/kizuna-vendor'])).toBe('D:/kizuna-vendor')
  })

  it('reads the inline form, including a path with an equals sign', () => {
    expect(parseVendorDirArg(['--vendor-dir=D:/a=b'])).toBe('D:/a=b')
  })

  it('returns undefined when the flag is absent', () => {
    expect(parseVendorDirArg(['--verbose'])).toBeUndefined()
  })
})

// The shipped lock is the input every other guarantee rests on. It is checked
// here rather than in the module's own suite because it asserts repo state, not
// module behaviour.
describe('resources.lock.json', () => {
  const lock = JSON.parse(readFileSync(join(REPO_ROOT, 'resources.lock.json'), 'utf-8'))

  it('passes the same validation the fetch script applies', () => {
    expect(lockProblems(lock)).toEqual([])
  })

  it('stages every binary path src/main/resourcePaths.ts resolves', () => {
    const staged = new Set(lock.files.map((f: { to: string }) => f.to))
    for (const path of [
      'mpv/mpv.exe',
      'ffmpeg/ffmpeg.exe',
      'ffmpeg/ffprobe.exe',
      'mecab/mecab.exe',
      'mecab/ipadic/sys.dic'
    ]) {
      expect(staged, `resources.lock.json never stages ${path}`).toContain(path)
    }
  })

  // MeCab reads `dicdir = $(rcpath)\ipadic` from mecabrc, so the config file has
  // to land beside `ipadic/` rather than in the mirror's own `mecab/etc/`.
  it('flattens mecabrc next to the ipadic directory it points at', () => {
    const mecabrc = lock.files.find((f: { to: string }) => f.to.endsWith('mecabrc'))
    expect(mecabrc.from).toBe('mecab/etc/mecabrc')
    expect(mecabrc.to).toBe('mecab/mecabrc')
  })

  // The point of the mirror: a binary reaches this repository from exactly one
  // host, so upstream link rot, a hijacked release page, or a silently
  // republished "same version" build cannot change what gets bundled. These two
  // assertions are what keep a convenient `https://…/latest` from creeping back
  // into the fetch path later.
  it('names the mirror as the only source, with no per-file download URLs', () => {
    expect(lock.source.repo).toBe('crpcrp/kizuna-vendor')
    for (const file of lock.files) {
      expect(Object.keys(file).sort()).toEqual(['from', 'sha256', 'to'])
    }
  })

  it('never reaches an upstream release host from the acquisition scripts', () => {
    const sources = ['scripts/fetch-resources.mjs', 'scripts/vendorResources.mjs']
      .map((path) => readFileSync(join(REPO_ROOT, path), 'utf-8'))
      .concat(JSON.stringify(lock))
      .join('\n')

    for (const host of ['gyan.dev', 'zhongfly', 'shogo82148', 'mpv-player', 'FFmpeg/FFmpeg']) {
      expect(sources, `the fetch path must not reference ${host}`).not.toContain(host)
    }
    expect(sources).toContain(lock.source.repo)
    expect(vendorRemoteUrl(lock.source.repo)).toBe(`https://github.com/${lock.source.repo}.git`)
  })

  it('carries the redistribution licences alongside the GPL binaries', () => {
    const staged = lock.files.map((f: { to: string }) => f.to)
    expect(staged).toContain('mpv/LICENSE.GPLv3.txt')
    expect(staged).toContain('ffmpeg/LICENSE.GPLv3.txt')
    expect(staged).toContain('mecab/LICENSE.BSD.txt')
    expect(staged).toContain('mecab/ipadic/COPYING')
  })
})
