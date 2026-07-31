import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import {
  decodeUtf8,
  parseJsonBytes,
  streamCappedUnzipSync,
  MAX_UNZIP_TOTAL_BYTES,
  MAX_UNZIP_ENTRY_BYTES
} from '@src/main/services/dict/yomitanArchive'

/** Drain a zip into a name → bytes map so assertions can look entries up by name. */
function collect(
  zipBytes: Uint8Array,
  maxEntryBytes?: number,
  maxTotalBytes?: number
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  streamCappedUnzipSync(
    zipBytes,
    (name, bytes) => {
      files[name] = bytes
    },
    maxEntryBytes,
    maxTotalBytes
  )
  return files
}

describe('streamCappedUnzipSync (counts actual inflated bytes)', () => {
  it('round-trips a normal multi-entry zip (deflated and stored)', () => {
    const zipBytes = zipSync({
      'index.json': [strToU8('{"title":"x"}'), { level: 6 }], // deflated
      'term_bank_1.json': [strToU8('[["猫","ねこ"]]'), { level: 0 }] // stored
    })

    const files = collect(zipBytes)

    expect(Object.keys(files).sort()).toEqual(['index.json', 'term_bank_1.json'])
    expect(decodeUtf8(files['index.json'])).toBe('{"title":"x"}')
    expect(decodeUtf8(files['term_bank_1.json'])).toBe('[["猫","ねこ"]]')
  })

  it('hands each entry to onFile as it finishes, in archive order', () => {
    const zipBytes = zipSync({
      'index.json': strToU8('{}'),
      'term_bank_1.json': strToU8('[]'),
      'term_meta_bank_1.json': strToU8('[]')
    })

    const seen: string[] = []
    streamCappedUnzipSync(zipBytes, (name) => {
      seen.push(name)
    })

    expect(seen).toEqual(['index.json', 'term_bank_1.json', 'term_meta_bank_1.json'])
  })

  it('propagates an error thrown by onFile instead of swallowing it', () => {
    const zipBytes = zipSync({ 'index.json': strToU8('{}') })

    expect(() =>
      streamCappedUnzipSync(zipBytes, () => {
        throw new Error('bank rejected')
      })
    ).toThrow('bank rejected')
  })

  it('aborts on a single entry whose DECOMPRESSED size exceeds the per-entry cap, even though the zip itself is tiny', () => {
    // 256 KiB of zeros compresses to a few hundred bytes: a "small file that
    // decompresses huge" — the essence of a zip bomb. The cap must trip on
    // the inflated byte count, not the compressed size or ZIP metadata.
    const bomb = new Uint8Array(256 * 1024)
    const zipBytes = zipSync({ 'term_bank_1.json': bomb })

    expect(zipBytes.byteLength).toBeLessThan(64 * 1024) // compressed input is tiny
    expect(() => collect(zipBytes, 64 * 1024, 512 * 1024 * 1024)).toThrow(
      'Dictionary is too large to import.'
    )
  })

  it('aborts once entries together exceed the total cap while each stays under the per-entry cap', () => {
    const chunk = new Uint8Array(40 * 1024)
    const zipBytes = zipSync({
      'term_bank_1.json': chunk,
      'term_bank_2.json': chunk,
      'term_bank_3.json': chunk
    })

    // per-entry cap 64 KiB (each 40 KiB entry is fine); total cap 100 KiB
    // (the third entry pushes the running total to 120 KiB → abort).
    expect(() => collect(zipBytes, 64 * 1024, 100 * 1024)).toThrow(
      'Dictionary is too large to import.'
    )
  })

  it('admits entries that stay within both caps', () => {
    const zipBytes = zipSync({ 'a.json': strToU8('hello'), 'b.json': strToU8('world') })

    const files = collect(zipBytes, 1024, 4096)

    expect(decodeUtf8(files['a.json'])).toBe('hello')
    expect(decodeUtf8(files['b.json'])).toBe('world')
  })

  it('rejects data that is not a zip (no End Of Central Directory record)', () => {
    expect(() => collect(new Uint8Array([1, 2, 3]))).toThrow('Invalid dictionary zip.')
    expect(() => collect(new Uint8Array(0))).toThrow('Invalid dictionary zip.')
  })

  it('admits a dictionary the size of jitendex, which the old 512 MiB total cap rejected', () => {
    // jitendex-yomitan.zip is a 38 MB download that inflates to 539,374,214
    // bytes — 2.4 MB past the previous ceiling, so importing it failed with
    // "Dictionary is too large to import." Assert against the constants
    // rather than inflating half a gigabyte in a unit test.
    const JITENDEX_INFLATED_BYTES = 539_374_214
    expect(MAX_UNZIP_TOTAL_BYTES).toBeGreaterThan(JITENDEX_INFLATED_BYTES)
    // BCCWJ's term_meta_bank_1.json is the largest single entry seen (77.5 MB).
    expect(MAX_UNZIP_ENTRY_BYTES).toBeGreaterThan(78 * 1024 * 1024)
    // Still a bound, not an open door.
    expect(MAX_UNZIP_TOTAL_BYTES).toBeLessThanOrEqual(2 * 1024 * 1024 * 1024)
  })
})

describe('entry decoding', () => {
  it('decodes UTF-8 entry bytes, including multi-byte characters', () => {
    expect(decodeUtf8(strToU8('音: ア　訓: つ.ぐ'))).toBe('音: ア　訓: つ.ぐ')
  })

  it('parses an entry as JSON', () => {
    expect(parseJsonBytes(strToU8('[["猫","ねこ"]]'))).toEqual([['猫', 'ねこ']])
  })

  it('throws on malformed JSON rather than returning a partial value', () => {
    expect(() => parseJsonBytes(strToU8('{ not json'))).toThrow()
  })
})
