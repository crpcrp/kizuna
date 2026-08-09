import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '@test/paths'

const workflow = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8')

function job(name: string, nextName?: string): string {
  const start = workflow.indexOf(`  ${name}:\n`)
  const end = nextName ? workflow.indexOf(`  ${nextName}:\n`, start + 1) : workflow.length
  expect(start, `${name} job is missing`).toBeGreaterThanOrEqual(0)
  expect(end, `${nextName} job is missing`).toBeGreaterThan(start)
  return workflow.slice(start, end)
}

describe('release workflow', () => {
  const validate = job('validate', 'build-windows')
  const windows = job('build-windows', 'build-linux')
  const linux = job('build-linux', 'publish')
  const publish = job('publish')

  it('validates the release ref once before either platform builds', () => {
    expect(validate).toContain('does not match package.json version')
    expect(validate).toContain('git merge-base --is-ancestor HEAD origin/main')
    expect(validate).toContain('Manual runs that create a release must run from main')
    expect(windows).toMatch(/^    needs: validate$/m)
    expect(linux).toMatch(/^    needs: validate$/m)
  })

  it('keeps read-only defaults and grants release permissions only to publishing', () => {
    expect(workflow).toMatch(/^permissions:\n  contents: read$/m)
    expect(validate).not.toMatch(/^    permissions:/m)
    expect(windows).not.toMatch(/^    permissions:/m)
    expect(linux).not.toMatch(/^    permissions:/m)
    expect(publish).toMatch(
      /^    permissions:\n      contents: write\n      id-token: write\n      attestations: write$/m
    )

    for (const [, action, ref] of workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)@(\S+)/gm)) {
      expect(ref, `${action}@${ref}`).toMatch(/^[0-9a-f]{40}$/)
    }
  })

  it('runs clean installs, platform resources, project checks, packaging, and smoke checks', () => {
    const sharedChecks = [
      'npm ci',
      'npm run typecheck',
      'npm run lint',
      'npm run format:check',
      'npm test'
    ]
    for (const command of sharedChecks) {
      expect(windows, `Windows: ${command}`).toContain(`run: ${command}`)
      expect(linux, `Linux: ${command}`).toContain(`run: ${command}`)
    }

    expect(windows).toContain('npm run resources -- --platform win32-x64')
    expect(windows).toContain('npm run dist')
    expect(windows).toContain('Smoke-test installed application')
    expect(linux).toContain('npm run resources -- --platform linux-x64')
    expect(linux).toContain('npm run dist:linux')
    expect(linux).toContain('npm run smoke:linux')
  })

  it('uploads only collision-proof platform assets and their own checksum manifests', () => {
    const expectedWindows = [
      'dist/kizuna-${{ needs.validate.outputs.version }}-setup.exe',
      'dist/kizuna-${{ needs.validate.outputs.version }}-setup.exe.blockmap',
      'dist/latest.yml',
      'dist/kizuna-${{ needs.validate.outputs.version }}-windows-x64-notices.zip',
      'dist/SHA256SUMS-windows.txt'
    ]
    const expectedLinux = [
      'dist/kizuna-${{ needs.validate.outputs.version }}-linux-x86_64.AppImage',
      'dist/kizuna-${{ needs.validate.outputs.version }}-linux-amd64.deb',
      'dist/latest-linux.yml',
      'dist/kizuna-${{ needs.validate.outputs.version }}-linux-x64-notices.tar.gz',
      'dist/SHA256SUMS-linux.txt'
    ]
    for (const path of expectedWindows) expect(windows, path).toContain(path)
    for (const path of expectedLinux) expect(linux, path).toContain(path)

    expect(windows).not.toMatch(/^\s+dist\/\*\//m)
    expect(linux).not.toMatch(/^\s+dist\/\*\//m)
    expect(windows).not.toContain('.AppImage')
    expect(windows).not.toContain('.deb')
    expect(linux).not.toContain('.exe')
    expect(windows).toContain(
      'node scripts/validate-update-metadata.mjs dist/latest.yml $installerName'
    )
    expect(linux).toContain(
      'node scripts/validate-update-metadata.mjs dist/latest-linux.yml "$appimage" "$deb"'
    )
  })

  it('publishes only after both platform jobs succeed', () => {
    expect(publish).toContain('needs: [validate, build-windows, build-linux]')
    expect(publish).toContain('success() &&')
    expect(publish).toContain('name: kizuna-windows-x64-release')
    expect(publish).toContain('name: kizuna-linux-x64-release')
  })

  it('rejects an inexact asset set and produces one canonical checksum manifest', () => {
    expect(publish).toContain('Unexpected files in $directory')
    expect(publish).toContain('does not cover exactly the expected assets')
    expect(publish).toContain('Duplicate release asset names')
    expect(publish).toContain('sha256sum "${all_assets[@]}" > SHA256SUMS.txt')
    expect(publish).toContain('sha256sum --check --strict SHA256SUMS.txt')
    expect(publish).toContain('subject-checksums: dist/SHA256SUMS.txt')
  })

  it('uploads the exact release formats and documents both platforms', () => {
    for (const glob of [
      'dist/*.exe',
      'dist/*.blockmap',
      'dist/*.AppImage',
      'dist/*.deb',
      'dist/*.yml',
      'dist/*-notices.zip',
      'dist/*-notices.tar.gz',
      'dist/SHA256SUMS.txt'
    ]) {
      expect(publish, glob).toContain(glob)
    }
    expect(publish).toContain('Windows 10 or newer')
    expect(publish).toContain('Ubuntu 24.04')
    expect(publish).toContain('The Windows installer and Linux packages are unsigned')
  })
})
