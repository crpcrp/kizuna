import { describe, expect, it } from 'vitest'

import { DEFAULT_OUT_DIR, parseOutDirArg, parsePlatformArg } from '@scripts/generate-notices.mjs'

// Importing this module must not generate anything: the entry point guards its
// `main()` on being invoked as a command. Only argv parsing is covered here —
// the generation logic lives in `notices.test.ts`.

describe('parseOutDirArg', () => {
  it('reads a separated --out flag', () => {
    expect(parseOutDirArg(['--out', 'dist/notices'])).toBe('dist/notices')
  })

  it('reads an inline --out= flag', () => {
    expect(parseOutDirArg(['--out=dist/notices'])).toBe('dist/notices')
  })

  it('returns undefined when the flag is absent, so the default applies', () => {
    expect(parseOutDirArg([])).toBeUndefined()
  })

  it('reads an explicit platform override', () => {
    expect(parsePlatformArg(['--platform', 'linux-x64'])).toBe('linux-x64')
    expect(parsePlatformArg(['--platform=win32-x64'])).toBe('win32-x64')
    expect(parsePlatformArg([])).toBeUndefined()
  })
})

describe('DEFAULT_OUT_DIR', () => {
  // electron-builder.cjs bundles `build/notices`; the two must not drift.
  it('is the directory electron-builder bundles', () => {
    expect(DEFAULT_OUT_DIR.replace(/\\/g, '/')).toBe('build/notices')
  })
})
