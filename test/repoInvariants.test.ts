import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { REPO_ROOT } from '@test/paths'
import { APP_ID, EXECUTABLE_NAME, PRODUCT_NAME } from '@src/shared/appIdentity'
import { VIDEO_EXTENSIONS } from '@src/shared/mediaFileTypes'
import {
  licenseFileNames,
  lockAgreementProblems,
  noticesProblems,
  productionPackages
} from '@scripts/notices.mjs'

// Rules that tie two independent sources together or that nothing else enforces.

const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf-8')
const readJson = <T>(rel: string): T => JSON.parse(read(rel)) as T
const builder = createRequire(import.meta.url)(join(REPO_ROOT, 'electron-builder.cjs')) as {
  appId: string
  productName: string
  executableName: string
  fileAssociations: { ext: string[] }[]
}

describe('GitHub Actions workflows', () => {
  const workflows = readdirSync(join(REPO_ROOT, '.github', 'workflows'))
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => ({ name, contents: read(`.github/workflows/${name}`) }))

  it('pins external Actions to full commit SHAs', () => {
    for (const { name, contents } of workflows) {
      for (const [, action, ref] of contents.matchAll(/^\s*-?\s*uses:\s*(\S+)@(\S+)/gm)) {
        expect(ref, `${name}: ${action}@${ref}`).toMatch(/^[0-9a-f]{40}$/)
      }
    }
  })

  it('does not use pull_request_target', () => {
    for (const { name, contents } of workflows) {
      expect(contents, name).not.toMatch(/^\s*pull_request_target:/m)
    }
  })
})

describe('packaging identity', () => {
  it('matches the runtime app identity', () => {
    expect(builder.appId).toBe(APP_ID)
    expect(builder.productName).toBe(PRODUCT_NAME)
    expect(builder.executableName).toBe(EXECUTABLE_NAME)
    expect(read('src/renderer/index.html')).toContain(`<title>${PRODUCT_NAME}</title>`)
  })

  it('associates the video extensions the application opens', () => {
    expect(builder.fileAssociations[0]?.ext).toEqual([...VIDEO_EXTENSIONS])
  })
})

describe('third-party notices', () => {
  type NoticesFile = import('@scripts/notices.mjs').NoticesFile
  const notices = readJson<NoticesFile>('third-party.json')

  it('is valid and agrees with resources.lock.json', () => {
    expect(noticesProblems(notices)).toEqual([])
    expect(lockAgreementProblems(notices, readJson('resources.lock.json'))).toEqual([])
  })

  it('finds a licence text for every production npm dependency', () => {
    const missing = productionPackages(readJson('package-lock.json'))
      .filter((pkg) => {
        const dir = join(REPO_ROOT, pkg.path)
        const fallback = notices.npmLicenseFallbacks?.[pkg.name]
        return (
          (!existsSync(dir) || licenseFileNames(readdirSync(dir)).length === 0) &&
          (!fallback || !existsSync(join(REPO_ROOT, fallback)))
        )
      })
      .map((pkg) => pkg.path)
    expect(missing).toEqual([])
  })
})

describe('documentation', () => {
  const docs = [
    'README.md',
    'CLAUDE.md',
    'AGENTS.md',
    'CONTRIBUTING.md',
    ...['src/main', 'src/renderer', 'test', 'scripts'].map((dir) => `${dir}/AGENTS.md`),
    ...readdirSync(join(REPO_ROOT, 'docs'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => `docs/${name}`)
  ]

  it('resolves every local Markdown link', () => {
    for (const doc of docs) {
      for (const [, link] of read(doc).matchAll(/\]\(([^)]+)\)/g)) {
        if (/^(https?:|mailto:|#)/.test(link)) continue
        const target = resolve(join(REPO_ROOT, dirname(doc)), link.split('#')[0])
        // Links such as ../../releases address GitHub, not the checkout.
        if (relative(REPO_ROOT, target).startsWith('..')) continue
        expect(existsSync(target), `${doc} -> ${link}`).toBe(true)
      }
    }
  })
})

describe('renderer theme', () => {
  const rendererSrc = join(REPO_ROOT, 'src', 'renderer', 'src')
  const theme = read('src/renderer/src/theme.css')
  const cssFiles = readdirSync(rendererSrc, { recursive: true, encoding: 'utf-8' })
    .filter((name) => name.endsWith('.css') && !name.endsWith('theme.css'))
    .map((name) => join(rendererSrc, name))
  const blockVariables = (selector: string): string[] => {
    const start = theme.indexOf(`${selector} {`)
    expect(start, selector).toBeGreaterThanOrEqual(0)
    const block = theme.slice(start, theme.indexOf('\n}', start))
    return [...block.matchAll(/(--[\w-]+):/g)].map((m) => m[1]).sort()
  }

  it('keeps color literals out of every stylesheet except theme.css', () => {
    expect(cssFiles.length).toBeGreaterThan(5)
    for (const file of cssFiles) {
      readFileSync(file, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          expect(
            /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(line),
            `${relative(REPO_ROOT, file)}:${i + 1}: ${line.trim()}`
          ).toBe(false)
        })
    }
  })

  it('defines the same variables in the dark and light blocks', () => {
    const dark = blockVariables(':root')
    expect(dark.length).toBeGreaterThan(0)
    expect(blockVariables(":root[data-theme='light']")).toEqual(dark)
  })
})
