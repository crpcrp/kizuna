import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  SUPPORTED_SCHEMA_VERSION,
  acquireResources,
  lockProblems,
  missingRequiredPaths,
  parseChecksums,
  sha256File,
  stageResources,
  vendorFetchSteps,
  vendorRemoteUrl,
  verificationError,
  verifyVendorFiles
} from '@scripts/vendorResources.mjs'

// No network and no git: the mirror is a throwaway directory of tiny text files
// standing in for mpv.exe and friends, and `materialize` is a spy. Everything
// this module actually decides — hash verification, layout mapping, fail-closed
// behaviour — is independent of the payload's size or format.

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

const COMMIT = 'a'.repeat(40)

/** A vendor tree plus the lock that describes it, in a fresh temp directory. */
async function makeMirror(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'kizuna-vendor-'))
  const vendorDir = join(root, 'mirror')
  const resourcesDir = join(root, 'resources')
  for (const [path, contents] of Object.entries(files)) {
    const full = join(vendorDir, path)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, contents)
  }
  return { root, vendorDir, resourcesDir }
}

const MIRROR_FILES = {
  'mpv/bin/mpv.exe': 'mpv-payload',
  'mpv/LICENSE.GPLv3.txt': 'gpl',
  'mecab/bin/mecab.exe': 'mecab-payload',
  'mecab/etc/mecabrc': 'dicdir = $(rcpath)\\ipadic',
  'mecab/ipadic/sys.dic': 'dictionary'
}

const LOCK = {
  schemaVersion: SUPPORTED_SCHEMA_VERSION,
  platform: 'win32-x64',
  source: { repo: 'crpcrp/kizuna-vendor', commit: COMMIT, manifest: 'm.json', checksums: 's.txt' },
  requiredPaths: ['mpv/mpv.exe', 'mecab/mecab.exe', 'mecab/mecabrc', 'mecab/ipadic/sys.dic'],
  files: Object.entries(MIRROR_FILES).map(([from, contents]) => ({
    from,
    to: from.replace(/^(mpv|ffmpeg|mecab)\/(bin|etc)\//, '$1/'),
    sha256: sha256(contents)
  }))
}

/** Deep copy so a test can corrupt one field without leaking into the next. */
const lock = (): typeof LOCK => JSON.parse(JSON.stringify(LOCK))

describe('parseChecksums', () => {
  it('reads sha256sum lines, including binary-mode entries', () => {
    const text = `${'1'.repeat(64)}  mpv/bin/mpv.exe\n${'2'.repeat(64)} *mecab/bin/mecab.exe\n`
    expect(parseChecksums(text)).toEqual({
      'mpv/bin/mpv.exe': '1'.repeat(64),
      'mecab/bin/mecab.exe': '2'.repeat(64)
    })
  })

  it('ignores blank lines and anything that is not a checksum', () => {
    expect(parseChecksums('\n# a comment\nnot a checksum line\n')).toEqual({})
  })
})

describe('lockProblems', () => {
  it('accepts the shipped lock shape', () => {
    expect(lockProblems(lock())).toEqual([])
  })

  it('rejects a schema version this script does not understand', () => {
    const bumped = { ...lock(), schemaVersion: 99 }
    expect(lockProblems(bumped)).toContain(
      `unsupported schemaVersion 99 (this script understands ${SUPPORTED_SCHEMA_VERSION})`
    )
  })

  it('rejects a short or branch-shaped commit, so the pin cannot drift', () => {
    const floating = lock()
    floating.source.commit = 'main'
    expect(lockProblems(floating)).toContain('source.commit must be a full 40-character commit SHA')
  })

  it('rejects a file entry without a valid sha256', () => {
    const unhashed = lock()
    unhashed.files[0].sha256 = ''
    expect(lockProblems(unhashed)).toContain('files entry "mpv/bin/mpv.exe" has no valid sha256')
  })

  it('rejects an empty requiredPaths, which would let a truncated mirror pass', () => {
    const loose = { ...lock(), requiredPaths: [] }
    expect(lockProblems(loose)).toContain(
      'requiredPaths is empty, so a truncated mirror would pass silently'
    )
  })
})

describe('vendorRemoteUrl', () => {
  // The mirror is public. Anonymous HTTPS is the only shape this produces, so
  // no credential can end up in an argv list, a log line, or a git remote.
  it('is an anonymous HTTPS clone URL, with no credential of any kind', () => {
    const url = vendorRemoteUrl('crpcrp/kizuna-vendor')
    expect(url).toBe('https://github.com/crpcrp/kizuna-vendor.git')
    expect(url).not.toContain('@')
  })
})

describe('vendorFetchSteps', () => {
  const steps = vendorFetchSteps({ url: 'https://example.test/v.git', commit: COMMIT })

  it('fetches only the pinned commit, at depth 1', () => {
    expect(steps.map((s) => s.argv)).toContainEqual([
      'fetch',
      '--depth',
      '1',
      '--no-tags',
      'origin',
      COMMIT
    ])
  })

  // Regression: the first CI run failed verification on 36 files — every text
  // file the mirror does not track through LFS — because windows-latest ships
  // core.autocrlf=true and rewrote their line endings on checkout. Each failing
  // hash was exactly the CRLF-converted form of the locked one.
  it('pins line-ending conversion off before the checkout can rewrite text files', () => {
    const argvs = steps.map((s) => s.argv)
    expect(argvs).toContainEqual(['config', 'core.autocrlf', 'false'])
    expect(argvs).toContainEqual(['config', 'core.eol', 'lf'])

    const configSteps = argvs
      .map((argv, i) => (argv[0] === 'config' ? i : -1))
      .filter((i) => i >= 0)
    const checkout = argvs.findIndex((argv) => argv.includes('checkout'))
    expect(Math.max(...configSteps)).toBeLessThan(checkout)
  })

  it('checks out with the LFS smudge filter off and pulls payloads afterwards', () => {
    const checkout = steps.find((s) => s.argv.includes('checkout'))
    expect(checkout?.env).toEqual({ GIT_LFS_SKIP_SMUDGE: '1' })
    expect(steps[steps.length - 1].argv).toEqual(['lfs', 'pull'])
  })

  it('tolerates only the pre-existing-remote cleanup failing', () => {
    expect(steps.filter((s) => s.allowFailure).map((s) => s.argv)).toEqual([
      ['remote', 'remove', 'origin']
    ])
  })
})

describe('sha256File', () => {
  it('hashes file contents', async () => {
    const { vendorDir } = await makeMirror(MIRROR_FILES)
    expect(await sha256File(join(vendorDir, 'mpv/bin/mpv.exe'))).toBe(sha256('mpv-payload'))
  })
})

describe('verifyVendorFiles', () => {
  it('reports nothing for a mirror matching the lock', async () => {
    const { vendorDir } = await makeMirror(MIRROR_FILES)
    expect(await verifyVendorFiles({ lock: lock(), vendorDir })).toEqual({
      missing: [],
      mismatched: []
    })
  })

  it('reports a file the mirror does not carry', async () => {
    const { vendorDir } = await makeMirror(MIRROR_FILES)
    const extended = lock()
    extended.files.push({ from: 'yt-dlp/yt-dlp.exe', to: 'yt-dlp/yt-dlp.exe', sha256: sha256('x') })
    const result = await verifyVendorFiles({ lock: extended, vendorDir })
    expect(result.missing).toEqual(['yt-dlp/yt-dlp.exe'])
  })

  it('reports a hash mismatch, which is what an unpulled LFS pointer looks like', async () => {
    const { vendorDir } = await makeMirror({
      ...MIRROR_FILES,
      'mpv/bin/mpv.exe': 'version https://git-lfs.github.com/spec/v1\noid sha256:dead\n'
    })
    const result = await verifyVendorFiles({ lock: lock(), vendorDir })
    expect(result.mismatched).toEqual([
      {
        path: 'mpv/bin/mpv.exe',
        expected: sha256('mpv-payload'),
        actual: expect.stringMatching(/^[0-9a-f]{64}$/)
      }
    ])
  })
})

describe('verificationError', () => {
  it('returns undefined for a clean result', () => {
    expect(verificationError({ missing: [], mismatched: [] }, COMMIT)).toBeUndefined()
  })

  it('names every missing and mismatched path plus the pinned commit', () => {
    const message = verificationError(
      {
        missing: ['mecab/bin/mecab.exe'],
        mismatched: [{ path: 'mpv/bin/mpv.exe', expected: 'aa', actual: 'bb' }]
      },
      COMMIT
    )
    expect(message).toContain(COMMIT)
    expect(message).toContain('missing: mecab/bin/mecab.exe')
    expect(message).toContain('hash mismatch: mpv/bin/mpv.exe')
  })

  // The message is the only diagnosis anyone gets from a CI log, and the first
  // version of it named Git LFS alone — which sent the reader down the wrong
  // path when the real cause was CRLF conversion.
  it('names line-ending conversion, unpulled LFS, and a stale pin as the causes', () => {
    const message = verificationError(
      { missing: [], mismatched: [{ path: 'mecab/etc/mecabrc', expected: 'aa', actual: 'bb' }] },
      COMMIT
    )
    expect(message).toContain('core.autocrlf=false')
    expect(message).toContain('git lfs pull')
    expect(message).toContain('source.commit')
  })
})

describe('stageResources', () => {
  it('flattens bin/ and etc/ into the layout resourcePaths.ts resolves', async () => {
    const { vendorDir, resourcesDir } = await makeMirror(MIRROR_FILES)
    const report = await stageResources({ lock: lock(), vendorDir, resourcesDir })

    expect(report.copied).toEqual([
      'mpv/mpv.exe',
      'mpv/LICENSE.GPLv3.txt',
      'mecab/mecab.exe',
      'mecab/mecabrc',
      'mecab/ipadic/sys.dic'
    ])
    expect(await readFile(join(resourcesDir, 'mpv/mpv.exe'), 'utf-8')).toBe('mpv-payload')
    expect(await readFile(join(resourcesDir, 'mecab/mecabrc'), 'utf-8')).toContain('dicdir')
  })

  it('is idempotent: a second run rewrites nothing', async () => {
    const { vendorDir, resourcesDir } = await makeMirror(MIRROR_FILES)
    await stageResources({ lock: lock(), vendorDir, resourcesDir })
    const second = await stageResources({ lock: lock(), vendorDir, resourcesDir })

    expect(second.copied).toEqual([])
    expect(second.skipped).toHaveLength(lock().files.length)
  })

  it('replaces a destination whose contents drifted from the lock', async () => {
    const { vendorDir, resourcesDir } = await makeMirror(MIRROR_FILES)
    await mkdir(join(resourcesDir, 'mpv'), { recursive: true })
    await writeFile(join(resourcesDir, 'mpv/mpv.exe'), 'stale build')

    const report = await stageResources({ lock: lock(), vendorDir, resourcesDir })
    expect(report.copied).toContain('mpv/mpv.exe')
    expect(await readFile(join(resourcesDir, 'mpv/mpv.exe'), 'utf-8')).toBe('mpv-payload')
  })
})

describe('missingRequiredPaths', () => {
  it('returns nothing once staging produced the full layout', async () => {
    const { vendorDir, resourcesDir } = await makeMirror(MIRROR_FILES)
    await stageResources({ lock: lock(), vendorDir, resourcesDir })
    expect(await missingRequiredPaths({ lock: lock(), resourcesDir })).toEqual([])
  })

  it('names an executable the app resolves but the lock never staged', async () => {
    const { resourcesDir } = await makeMirror(MIRROR_FILES)
    expect(await missingRequiredPaths({ lock: lock(), resourcesDir })).toEqual(LOCK.requiredPaths)
  })
})

describe('acquireResources', () => {
  it('materialises the pinned commit, then verifies and stages it', async () => {
    const { vendorDir, resourcesDir } = await makeMirror(MIRROR_FILES)
    const seen: string[][] = []

    const report = await acquireResources({
      lock: lock(),
      vendorDir,
      resourcesDir,
      materialize: async (steps) => {
        for (const step of steps) seen.push(step.argv)
      }
    })

    expect(report.copied).toHaveLength(LOCK.files.length)
    expect(seen).toContainEqual([
      'remote',
      'add',
      'origin',
      'https://github.com/crpcrp/kizuna-vendor.git'
    ])
  })

  it('skips git entirely when an existing checkout is supplied', async () => {
    const { vendorDir, resourcesDir } = await makeMirror(MIRROR_FILES)
    const messages: string[] = []

    await acquireResources({ lock: lock(), vendorDir, resourcesDir, log: (m) => messages.push(m) })
    expect(messages[0]).toContain('Using existing vendor checkout')
  })

  it('fails closed on a hash mismatch, before touching resources/', async () => {
    const { vendorDir, resourcesDir } = await makeMirror({
      ...MIRROR_FILES,
      'mecab/ipadic/sys.dic': 'tampered'
    })

    await expect(acquireResources({ lock: lock(), vendorDir, resourcesDir })).rejects.toThrow(
      /hash mismatch: mecab\/ipadic\/sys\.dic/
    )
    await expect(missingRequiredPaths({ lock: lock(), resourcesDir })).resolves.toEqual(
      LOCK.requiredPaths
    )
  })

  it('fails closed when a required executable never appears in resources/', async () => {
    const partial = lock()
    partial.files = partial.files.filter((f) => f.from !== 'mecab/bin/mecab.exe')
    const { vendorDir, resourcesDir } = await makeMirror(MIRROR_FILES)

    await expect(acquireResources({ lock: partial, vendorDir, resourcesDir })).rejects.toThrow(
      /missing required paths after staging:\s+mecab\/mecab\.exe/
    )
  })

  it('refuses an unusable lock before any download is attempted', async () => {
    const { vendorDir, resourcesDir } = await makeMirror(MIRROR_FILES)
    const floating = lock()
    floating.source.commit = 'main'
    let materialized = false

    await expect(
      acquireResources({
        lock: floating,
        vendorDir,
        resourcesDir,
        materialize: async () => {
          materialized = true
        }
      })
    ).rejects.toThrow(/resources\.lock\.json is unusable/)
    expect(materialized).toBe(false)
  })
})
