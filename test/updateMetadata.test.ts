import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '@test/paths'
import { createRequire } from 'node:module'

const script = join(REPO_ROOT, 'scripts', 'validate-update-metadata.mjs')
const require = createRequire(import.meta.url)

function fixture(url = 'kizuna-1.0.0-setup.exe') {
  const directory = mkdtempSync(join(tmpdir(), 'kizuna-update-metadata-'))
  const payload = join(directory, url)
  const contents = Buffer.from('installer')
  writeFileSync(payload, contents)
  const sha512 = createHash('sha512').update(contents).digest('base64')
  const metadata = join(directory, 'latest.yml')
  writeFileSync(
    metadata,
    `version: 1.0.0\nfiles:\n  - url: ${url}\n    sha512: ${sha512}\n    size: ${contents.length}\npath: ${url}\nsha512: ${sha512}\n`
  )
  return { metadata, payload: url }
}

function validate(metadata: string, payload: string) {
  return spawnSync(process.execPath, [script, metadata, payload], { encoding: 'utf8' })
}

describe('updater metadata validation', () => {
  it('configures prerelease metadata for the public GitHub repository', () => {
    const config = require(join(REPO_ROOT, 'electron-builder.cjs'))

    expect(config.publish).toEqual([
      {
        provider: 'github',
        owner: 'crpcrp',
        repo: 'kizuna',
        channel: 'latest',
        releaseType: 'prerelease'
      }
    ])
    expect(config.electronUpdaterCompatibility).toBe('>=6.8.9')
  })

  it('accepts builder metadata whose payload size and SHA-512 match', () => {
    const item = fixture()
    expect(validate(item.metadata, item.payload).status).toBe(0)
  })

  it('rejects a mismatched payload checksum', () => {
    const item = fixture()
    writeFileSync(join(item.metadata, '..', item.payload), 'tampered!')
    expect(validate(item.metadata, item.payload).stderr).toContain('SHA-512 does not match')
  })

  it('rejects paths outside the release asset directory', () => {
    const item = fixture('../setup.exe')
    expect(validate(item.metadata, item.payload).stderr).toContain('unsafe payload path')
  })
})
