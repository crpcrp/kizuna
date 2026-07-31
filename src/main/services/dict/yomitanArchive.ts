// Reading a Yomitan dictionary zip: signature validation, streamed inflation
// under size caps, and decoding entry bytes. This module knows nothing about
// bank formats or the database — it hands raw entries to a callback and lets
// the caller decide what each one means.

import { Unzip as FflateUnzip, UnzipInflate, UnzipPassThrough } from 'fflate'

/**
 * Cap on the total decompressed size of an imported dictionary zip. A small
 * highly-compressed input ("zip bomb") can expand to gigabytes; without a cap
 * the `unzip` + `JSON.parse` of every entry can OOM (or CPU-pin) the import
 * worker.
 *
 * This has to clear the largest dictionaries people actually import, which are
 * bigger than they look: jitendex ships a 38 MB zip that decompresses to
 * 539,374,214 bytes (514.4 MiB) of JSON and AVIF graphics. The previous 512 MiB
 * ceiling sat *below* that, so a legitimate dictionary was rejected with
 * "Dictionary is too large to import." — 2.4 MB over the line. 2 GiB leaves
 * real headroom while still stopping a runaway expansion; peak memory stays
 * bounded by `MAX_UNZIP_ENTRY_BYTES` regardless, since the streaming importer
 * only ever retains one inflated entry at a time.
 */
export const MAX_UNZIP_TOTAL_BYTES = 2 * 1024 * 1024 * 1024

/**
 * Cap on any single decompressed entry inside an imported dictionary zip.
 * This one does bound peak memory, so it stays far tighter than the total.
 * The largest real entry observed is BCCWJ's 77.5 MB `term_meta_bank_1.json`.
 */
export const MAX_UNZIP_ENTRY_BYTES = 256 * 1024 * 1024

/**
 * Compressed bytes fed to the streaming unzip per step. Small enough that the
 * decompressed output produced between size checks stays bounded (worst-case
 * DEFLATE expansion ≈ 1032×, so ≈ 64 MiB per step) — this is what lets the cap
 * abort a "lying" zip bomb before it can pin the worker on CPU.
 */
export const UNZIP_FEED_CHUNK_BYTES = 64 * 1024

const utf8Decoder = new TextDecoder()

/** Decode one archive entry's bytes as UTF-8 text (`index.json`, `styles.css`, banks). */
export function decodeUtf8(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes)
}

/** Decode and `JSON.parse` one archive entry. Throws on malformed JSON. */
export function parseJsonBytes(bytes: Uint8Array): unknown {
  return JSON.parse(decodeUtf8(bytes))
}

/**
 * Reject data that isn't a ZIP up front, mirroring `unzipSync`'s precondition
 * (streaming `Unzip` is lenient — it parses local headers and would silently
 * yield `{}` for garbage, importing a corrupt file as an empty dictionary). A
 * valid ZIP ends with an End Of Central Directory record (signature
 * `0x06054b50`) within the last 22 + 65535 bytes.
 */
function assertLooksLikeZip(data: Uint8Array): void {
  const readU32LE = (o: number): number =>
    (data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) | (data[o + 3] << 24)) >>> 0
  let e = data.length - 22
  if (e < 0) throw new Error('Invalid dictionary zip.')
  for (; readU32LE(e) !== 0x06054b50; --e) {
    if (!e || data.length - e > 65558) throw new Error('Invalid dictionary zip.')
  }
}

/** Concatenate decompressed chunks (each an independent copy from fflate) into one buffer. */
function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let pos = 0
  for (const chunk of chunks) {
    out.set(chunk, pos)
    pos += chunk.length
  }
  return out
}

/**
 * Decompress a dictionary zip while enforcing size caps on the **actual**
 * inflated byte count, not the (attacker-controlled) ZIP metadata.
 *
 * The compressed input is fed to fflate's streaming `Unzip` a chunk at a time,
 * and each entry's `ondata` accumulates decompressed bytes. The moment an
 * entry exceeds `maxEntryBytes` or the running total exceeds `maxTotalBytes`,
 * it throws `Error('Dictionary is too large to import.')`. Because a "zip bomb"
 * that understates its size in the central directory would otherwise still make
 * fflate walk the entire deflate stream (a fixed output buffer only silences
 * the writes, it does not stop the work), counting real emitted bytes and
 * feeding small compressed chunks bounds both memory and CPU: at most one
 * ~64 MiB step of expansion happens past the cap before the abort.
 *
 * `onFile` receives each entry as it finishes inflating, so only one inflated
 * entry is retained at a time. Caps are parameters (defaulting to the module
 * constants) so tests can drive the abort with small inputs.
 */
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
