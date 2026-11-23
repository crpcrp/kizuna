import * as fs from 'node:fs'
import type { HttpFetch } from '../http'
import { pathApiFor } from '../../platformPath'

export interface TatoebaExport {
  name: string
  url: string
}

/** Per-language exports where Tatoeba offers them; user languages exists only as a full dump. */
export const TATOEBA_EXPORTS = [
  {
    name: 'jpn_sentences_detailed.tsv.bz2',
    url: 'https://downloads.tatoeba.org/exports/per_language/jpn/jpn_sentences_detailed.tsv.bz2'
  },
  {
    name: 'eng_sentences.tsv.bz2',
    url: 'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2'
  },
  {
    name: 'jpn-eng_links.tsv.bz2',
    url: 'https://downloads.tatoeba.org/exports/per_language/jpn/jpn-eng_links.tsv.bz2'
  },
  {
    name: 'user_languages.tar.bz2',
    url: 'https://downloads.tatoeba.org/exports/user_languages.tar.bz2'
  }
] as const satisfies readonly TatoebaExport[]

export interface SourceFile {
  name: string
  url: string
  size: number
  lastModified: string | null
}

export const SOURCES_FILE = 'sources.json'

// About 32 MB in total as of November 2026; the bound only rejects a runaway response.
const MAX_EXPORT_BYTES = 512 * 1024 * 1024
const PROBE_TIMEOUT_MS = 30_000

export class DownloadHttpError extends Error {
  override name = 'DownloadHttpError'
}

interface Probe {
  file: TatoebaExport
  size: number
  lastModified: string | null
}

async function probe(fetch: HttpFetch, file: TatoebaExport, signal?: AbortSignal): Promise<Probe> {
  const response = await fetch(file.url, {
    method: 'HEAD',
    redirect: 'error',
    signal,
    timeoutMs: PROBE_TIMEOUT_MS
  })
  if (!response.ok) throw new DownloadHttpError(`Tatoeba returned HTTP ${response.status}`)
  const size = Number(response.headers.get('content-length'))
  return {
    file,
    size: Number.isSafeInteger(size) && size > 0 ? size : 0,
    lastModified: response.headers.get('last-modified')
  }
}

/** Total compressed size of the exports, from the server's `Content-Length`. */
export async function exportsSize(fetch: HttpFetch, signal?: AbortSignal): Promise<number> {
  const probes = await Promise.all(TATOEBA_EXPORTS.map((file) => probe(fetch, file, signal)))
  return probes.reduce((sum, { size }) => sum + size, 0)
}

export function readCachedSources(
  downloadsDir: string,
  platform: NodeJS.Platform = process.platform
): SourceFile[] | undefined {
  const { join } = pathApiFor(platform)
  try {
    const sources = JSON.parse(
      fs.readFileSync(join(downloadsDir, SOURCES_FILE), 'utf-8')
    ) as SourceFile[]
    const complete = TATOEBA_EXPORTS.every((file) =>
      sources.some((source) => source.name === file.name)
    )
    return complete && sources.every((source) => fs.existsSync(join(downloadsDir, source.name)))
      ? sources
      : undefined
  } catch {
    return undefined
  }
}

async function downloadTo(
  fetch: HttpFetch,
  url: string,
  path: string,
  signal: AbortSignal,
  onBytes: (bytes: number) => void
): Promise<void> {
  const response = await fetch(url, { redirect: 'error', signal })
  if (!response.ok) throw new DownloadHttpError(`Tatoeba returned HTTP ${response.status}`)
  const handle = await fs.promises.open(path, 'w')
  try {
    let total = 0
    for await (const chunk of response.body) {
      total += chunk.byteLength
      if (total > MAX_EXPORT_BYTES) throw new DownloadHttpError('Tatoeba export is too large')
      await handle.write(chunk)
      onBytes(chunk.byteLength)
    }
  } finally {
    await handle.close()
  }
}

/**
 * Downloads every export that changed since the cached copy into `.part` files,
 * then moves them into place together, so a failed or cancelled run leaves the
 * previous cache untouched.
 */
export async function downloadExports(
  fetch: HttpFetch,
  downloadsDir: string,
  signal: AbortSignal,
  onProgress: (received: number, total: number) => void,
  platform: NodeJS.Platform = process.platform
): Promise<SourceFile[]> {
  const { join } = pathApiFor(platform)
  await fs.promises.mkdir(downloadsDir, { recursive: true })
  const cached = readCachedSources(downloadsDir, platform) ?? []
  const probes = await Promise.all(TATOEBA_EXPORTS.map((file) => probe(fetch, file, signal)))
  const stale = probes.filter(({ file, lastModified }) => {
    const previous = cached.find((source) => source.name === file.name)
    return !previous || lastModified === null || previous.lastModified !== lastModified
  })

  const total = stale.reduce((sum, { size }) => sum + size, 0)
  let received = 0
  onProgress(0, total)
  const parts = stale.map(({ file }) => join(downloadsDir, `${file.name}.part`))
  try {
    for (const [index, { file }] of stale.entries()) {
      await downloadTo(fetch, file.url, parts[index], signal, (bytes) => {
        received += bytes
        onProgress(received, Math.max(total, received))
      })
    }
    for (const [index, { file }] of stale.entries()) {
      await fs.promises.rename(parts[index], join(downloadsDir, file.name))
    }
  } finally {
    await Promise.all(parts.map((part) => fs.promises.rm(part, { force: true })))
  }

  const sources: SourceFile[] = probes.map(({ file, lastModified }) => {
    const previous = cached.find((source) => source.name === file.name)
    const fresh = stale.some((entry) => entry.file === file)
    return {
      name: file.name,
      url: file.url,
      size: fs.statSync(join(downloadsDir, file.name)).size,
      lastModified: fresh ? lastModified : (previous?.lastModified ?? lastModified)
    }
  })
  await fs.promises.writeFile(join(downloadsDir, SOURCES_FILE), JSON.stringify(sources, null, 2))
  return sources
}
