import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '@test/paths'
import { APP_ID, EXECUTABLE_NAME, PRODUCT_NAME } from '@src/shared/appIdentity'

// Packaging and runtime identity must come from one file. Nothing in `tsc`,
// eslint, or the product tests catches a hand-written `productName` or `appId`
// in the packaging config, so it is asserted here.
//
// This file has no counterpart under `src/` — like `repoConfig.test.ts`, it
// tests repository configuration rather than a module.

const require = createRequire(import.meta.url)

/** The electron-builder configuration as electron-builder itself loads it. */
function builderConfig(): Record<string, unknown> {
  return require(join(REPO_ROOT, 'electron-builder.cjs')) as Record<string, unknown>
}

function packageJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >
}

describe('app identity configuration', () => {
  it('gives electron-builder the identity the application uses at runtime', () => {
    const config = builderConfig()
    expect(config.appId).toBe(APP_ID)
    expect(config.productName).toBe(PRODUCT_NAME)
    expect(config.executableName).toBe(EXECUTABLE_NAME)
  })

  it('keeps no competing packaging config in package.json', () => {
    // electron-builder prefers a config file over package.json's `build` key,
    // so a leftover `build` would be dead but misleading configuration.
    expect(packageJson().build).toBeUndefined()
  })

  it('lives at a filename electron-builder discovers without an explicit flag', () => {
    // `npm run dist` calls plain `electron-builder`, which scans the project
    // directory for `electron-builder.{yml,yaml,json,json5,toml,js,cjs,ts}`.
    const dist = (packageJson().scripts as Record<string, string>).dist
    expect(dist).toContain('electron-builder')
    expect(() => builderConfig()).not.toThrow()
  })

  it('pins the renderer entry title, which cannot import the identity module', () => {
    const html = readFileSync(join(REPO_ROOT, 'src', 'renderer', 'index.html'), 'utf8')
    expect(html).toContain(`<title>${PRODUCT_NAME}</title>`)
  })

  it('still bundles every runtime resource directory the app resolves', () => {
    const extraResources = builderConfig().extraResources as { from: string; to: string }[]
    expect(extraResources.map((entry) => entry.to)).toEqual([
      'mpv',
      'ffmpeg',
      'mecab',
      'icons',
      // Not a runtime resource but shipped the same way; see noticesConfig.test.ts.
      'notices'
    ])
  })
})
