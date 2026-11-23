import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DownloadHttpError,
  downloadExports,
  exportsSize,
  readCachedSources,
  TATOEBA_EXPORTS
} from '@src/main/services/grammarExamples/download'
import { fakeHttp, type FakeHttpRoute } from '@test/harness/fakeHttp'

const OLD = 'Fri, 20 Nov 2026 06:00:00 GMT'
const NEW = 'Sat, 21 Nov 2026 06:00:00 GMT'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), 'kizuna-tatoeba-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const body = (name: string): Uint8Array => new TextEncoder().encode(`${name} body`)

function exportsRoute(
  lastModified: string,
  override: Partial<Record<string, FakeHttpRoute | FakeHttpRoute[]>> = {}
) {
  return fakeHttp(
    Object.fromEntries(
      TATOEBA_EXPORTS.map((file) => [
        file.url,
        override[file.name] ?? {
          headers: {
            'content-length': String(body(file.name).byteLength),
            'last-modified': lastModified
          },
          bytes: [body(file.name).subarray(0, 4), body(file.name).subarray(4)]
        }
      ])
    )
  )
}

const leftovers = (): string[] => fs.readdirSync(dir).filter((name) => name.endsWith('.part'))

describe('downloadExports', () => {
  it('downloads every export over HTTPS and records its metadata', async () => {
    const http = exportsRoute(NEW)
    const progress: Array<[number, number]> = []

    const sources = await downloadExports(
      http.fetch,
      dir,
      new AbortController().signal,
      (received, total) => progress.push([received, total])
    )

    expect(http.calls.every((call) => call.url.startsWith('https://'))).toBe(true)
    expect(sources.map((source) => [source.name, source.lastModified])).toEqual(
      TATOEBA_EXPORTS.map((file) => [file.name, NEW])
    )
    for (const file of TATOEBA_EXPORTS) {
      expect(fs.readFileSync(join(dir, file.name), 'utf-8')).toBe(`${file.name} body`)
    }
    const total = TATOEBA_EXPORTS.reduce((sum, file) => sum + body(file.name).byteLength, 0)
    expect(progress.at(0)).toEqual([0, total])
    expect(progress.at(-1)).toEqual([total, total])
    expect(readCachedSources(dir)).toEqual(sources)
  })

  it('re-downloads only exports that changed', async () => {
    await downloadExports(exportsRoute(OLD).fetch, dir, new AbortController().signal, () => {})
    const http = exportsRoute(OLD, {
      'eng_sentences.tsv.bz2': {
        headers: { 'last-modified': NEW },
        bytes: new TextEncoder().encode('newer')
      }
    })

    await downloadExports(http.fetch, dir, new AbortController().signal, () => {})

    const gets = http.calls.filter((call) => call.init?.method !== 'HEAD').map((call) => call.url)
    expect(gets).toEqual([TATOEBA_EXPORTS[1].url])
    expect(fs.readFileSync(join(dir, 'eng_sentences.tsv.bz2'), 'utf-8')).toBe('newer')
  })

  it('fails with a retryable error and never uses a partial file', async () => {
    await downloadExports(exportsRoute(OLD).fetch, dir, new AbortController().signal, () => {})
    const before = fs.readFileSync(join(dir, 'jpn_sentences_detailed.tsv.bz2'), 'utf-8')
    const http = exportsRoute(NEW, {
      'user_languages.tar.bz2': [{ headers: { 'last-modified': NEW } }, { status: 503 }]
    })

    await expect(
      downloadExports(http.fetch, dir, new AbortController().signal, () => {})
    ).rejects.toBeInstanceOf(DownloadHttpError)

    expect(fs.readFileSync(join(dir, 'jpn_sentences_detailed.tsv.bz2'), 'utf-8')).toBe(before)
    expect(readCachedSources(dir)?.[0].lastModified).toBe(OLD)
    expect(leftovers()).toEqual([])
  })

  it('stops when cancelled and leaves no cache', async () => {
    const controller = new AbortController()
    const http = exportsRoute(NEW, {
      'jpn-eng_links.tsv.bz2': [{ headers: { 'last-modified': NEW } }, { deferred: true }]
    })

    const pending = downloadExports(http.fetch, dir, controller.signal, (received) => {
      if (received > 0) controller.abort()
    })

    await expect(pending).rejects.toThrow()
    expect(readCachedSources(dir)).toBeUndefined()
    expect(leftovers()).toEqual([])
  })
})

describe('exportsSize', () => {
  it('sums the Content-Length of every export', async () => {
    const http = exportsRoute(NEW)
    const total = TATOEBA_EXPORTS.reduce((sum, file) => sum + body(file.name).byteLength, 0)
    await expect(exportsSize(http.fetch)).resolves.toBe(total)
    expect(http.calls.every((call) => call.init?.method === 'HEAD')).toBe(true)
  })
})
