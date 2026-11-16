import { Unzip as FflateUnzip, UnzipInflate, UnzipPassThrough } from 'fflate'

// Bound zip-bomb expansion while allowing large dictionaries: jitendex expands to
// 539,374,214 bytes (514.4 MiB), including JSON and AVIF graphics.
export const MAX_UNZIP_TOTAL_BYTES = 2 * 1024 * 1024 * 1024

// Bound peak entry memory; BCCWJ term_meta_bank_1.json has been observed at 77.5 MB.
const MAX_UNZIP_ENTRY_BYTES = 256 * 1024 * 1024

// Worst-case DEFLATE expansion is about 1032×: 64 KiB input bounds each step
// to about 64 MiB output before the next size check can abort a zip bomb.
const UNZIP_FEED_CHUNK_BYTES = 64 * 1024

const utf8Decoder = new TextDecoder()

export function decodeUtf8(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes)
}

export function parseJsonBytes(bytes: Uint8Array): unknown {
  return JSON.parse(decodeUtf8(bytes))
}

// Streaming Unzip accepts garbage as an empty archive. Require the ZIP end-of-central-
// directory signature (0x06054b50) within the final 22 + 65535 bytes.
function assertLooksLikeZip(data: Uint8Array): void {
  const readU32LE = (o: number): number =>
    (data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) | (data[o + 3] << 24)) >>> 0
  let e = data.length - 22
  if (e < 0) throw new Error('Invalid dictionary zip.')
  for (; readU32LE(e) !== 0x06054b50; --e) {
    if (!e || data.length - e > 65558) throw new Error('Invalid dictionary zip.')
  }
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let pos = 0
  for (const chunk of chunks) {
    out.set(chunk, pos)
    pos += chunk.length
  }
  return out
}

// Count actual inflated bytes, not attacker-controlled ZIP sizes; stream entries
// individually so only one inflated entry is retained at a time.
export function streamCappedUnzipSync(
  zipBytes: Uint8Array,
  onFile: (name: string, bytes: Uint8Array) => void,
  maxEntryBytes: number = MAX_UNZIP_ENTRY_BYTES,
  maxTotalBytes: number = MAX_UNZIP_TOTAL_BYTES,
  feedChunkBytes: number = UNZIP_FEED_CHUNK_BYTES
): void {
  assertLooksLikeZip(zipBytes)

  let total = 0
  let failure: Error | null = null

  const unz = new FflateUnzip((file) => {
    const chunks: Uint8Array[] = []
    let entryBytes = 0
    file.ondata = (err, chunk, final) => {
      if (failure) return
      if (err) {
        failure = err instanceof Error ? err : new Error(String(err))
        return
      }
      entryBytes += chunk.length
      total += chunk.length
      if (entryBytes > maxEntryBytes || total > maxTotalBytes) {
        failure = new Error('Dictionary is too large to import.')
        return
      }
      chunks.push(chunk)
      if (final) {
        try {
          onFile(file.name, concatChunks(chunks, entryBytes))
        } catch (err) {
          failure = err instanceof Error ? err : new Error(String(err))
        }
        chunks.length = 0
      }
    }
    file.start()
  })
  // Register both stored (compression 0) and DEFLATE (8) decoders — the only
  // methods Yomitan dictionary zips use.
  unz.register(UnzipInflate)
  unz.register(UnzipPassThrough)

  for (let off = 0; off < zipBytes.length && !failure; off += feedChunkBytes) {
    const end = Math.min(off + feedChunkBytes, zipBytes.length)
    unz.push(zipBytes.subarray(off, end), end >= zipBytes.length)
  }

  if (failure) throw failure
}
