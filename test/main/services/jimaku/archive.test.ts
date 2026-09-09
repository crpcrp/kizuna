import { Zip, ZipPassThrough, strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseJimakuVideoIdentity } from '@src/shared/jimakuMatching'
import type { JimakuFileRecord } from '@src/main/services/jimaku/client'
import {
  createJimakuArchiveService,
  type CreateJimakuArchiveServiceDeps
} from '@src/main/services/jimaku/archive'
import type {
  JimakuDownloadStore,
  JimakuPreparedPackage,
  JimakuPreparedSubtitle
} from '@src/main/services/jimaku/downloadStore'

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nこんにちは\n'
const SRT_BYTES = strToU8(SRT)

function fileRecord(bytes: Uint8Array, name = 'pack.zip'): JimakuFileRecord {
  return {
    name,
    size: bytes.byteLength,
    lastModified: 'revision-1',
    url: `https://jimaku.cc/entry/42/download/${name}`
  }
}

function makeDownloads(bytes: Uint8Array) {
  const packagePrepared: JimakuPreparedPackage = {
    handle: 'store-package-1',
    contentVersion: 'a'.repeat(64),
    originalName: 'pack.zip',
    format: 'zip',
    managedPath: '/cache/pack.zip',
    size: bytes.byteLength,
    provenance: {
      entryId: 42,
      remoteFilename: 'pack.zip',
      remoteRevision: 'revision-1'
    }
  }
  const calls: { preparePackage: number; extracted: Array<{ name: string; bytes: Uint8Array }> } = {
    preparePackage: 0,
    extracted: []
  }
  const released: string[] = []
  const downloads: Pick<
    JimakuDownloadStore,
    'preparePackage' | 'prepareExtracted' | 'readPrepared' | 'releasePrepared'
  > = {
    preparePackage: async () => {
      calls.preparePackage += 1
      return { ok: true, value: packagePrepared }
    },
    prepareExtracted: async (entryId, sourceFile, memberName, memberBytes) => {
      calls.extracted.push({ name: memberName, bytes: memberBytes.slice() })
      const prepared: JimakuPreparedSubtitle = {
        handle: `subtitle-${calls.extracted.length}`,
        contentVersion: 'b'.repeat(64),
        originalName: memberName,
        format: memberName.toLowerCase().endsWith('.ass') ? 'ass' : 'srt',
        managedPath: `/cache/${calls.extracted.length}.srt`,
        size: memberBytes.byteLength,
        provenance: {
          entryId,
          remoteFilename: sourceFile.name,
          remoteRevision: sourceFile.lastModified,
          archiveMemberName: memberName
        }
      }
      return { ok: true, value: prepared }
    },
    readPrepared: async (handle) => (handle === packagePrepared.handle ? bytes.slice() : undefined),
    releasePrepared: (handle) => released.push(handle)
  }
  return { downloads, calls, released }
}

function makeService(bytes: Uint8Array, overrides: Partial<CreateJimakuArchiveServiceDeps> = {}) {
  const fake = makeDownloads(bytes)
  const service = createJimakuArchiveService({
    downloads: fake.downloads,
    makePackageHandle: () => 'package-1',
    makeMemberId: (packageHandle, index) => `${packageHandle}-member-${index}`,
    ...overrides
  })
  return { ...fake, service }
}

function zipFiles(files: readonly [string, Uint8Array][]): Uint8Array {
  const chunks: Uint8Array[] = []
  const archive = new Zip((error, chunk) => {
    if (error) throw error
    chunks.push(chunk)
  })
  for (const [name, bytes] of files) {
    const file = new ZipPassThrough(name)
    archive.add(file)
    file.push(bytes, true)
  }
  archive.end()
  return join(chunks)
}

function join(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function firstCentralOffset(bytes: Uint8Array): number {
  for (let offset = 0; offset + 4 <= bytes.length; offset += 1) {
    if (readU32(bytes, offset) === 0x02014b50) return offset
  }
  throw new Error('central directory not found')
}

function mutateCentral(bytes: Uint8Array, mutate: (bytes: Uint8Array, offset: number) => void) {
  const copy = bytes.slice()
  mutate(copy, firstCentralOffset(copy))
  return copy
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

describe('Jimaku archive service', () => {
  it('inspects a pack, ranks supported members, and prepares only the selected member', async () => {
    const bytes = zipSync({
      'subtitles/Title - 07 [ja].SRT': SRT_BYTES,
      'Title - 08.ass': strToU8(SRT),
      'readme.txt': strToU8('ignore'),
      'other-pack.zip': strToU8('nested')
    })
    const { service, calls, released } = makeService(bytes)

    const result = await service.inspect(
      42,
      fileRecord(bytes),
      parseJimakuVideoIdentity('Title - 07.mkv'),
      false
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.members).toHaveLength(2)
    expect(result.value.members[0]).toMatchObject({
      displayName: 'subtitles/Title - 07 [ja].SRT',
      format: 'srt',
      size: SRT_BYTES.byteLength,
      inferredEpisode: 7,
      status: 'eligible'
    })
    expect(result.value.members[1]).toMatchObject({
      displayName: 'Title - 08.ass',
      inferredEpisode: 8,
      status: 'excluded',
      reasons: expect.arrayContaining(['Different episode'])
    })
    expect(result.value.members[0]?.memberId).not.toBe(result.value.members[1]?.memberId)

    const prepared = await service.prepareMember(
      result.value.packageHandle,
      result.value.members[0].memberId
    )
    expect(prepared).toMatchObject({
      ok: true,
      value: { originalName: result.value.members[0].displayName }
    })
    expect(calls.extracted).toEqual([{ name: 'subtitles/Title - 07 [ja].SRT', bytes: SRT_BYTES }])
    expect(calls.preparePackage).toBe(1)

    service.releasePackage(result.value.packageHandle)
    expect(released).toEqual(['store-package-1'])
    await expect(
      service.prepareMember(result.value.packageHandle, result.value.members[0].memberId)
    ).resolves.toEqual({ ok: false, error: { code: 'invalidMember' } })
  })

  it('keeps duplicate member names independently selectable', async () => {
    const first = strToU8(SRT)
    const second = strToU8(SRT.replace('こんにちは', 'さようなら'))
    const bytes = zipFiles([
      ['Title - 07.srt', first],
      ['Title - 07.srt', second]
    ])
    const { service, calls } = makeService(bytes)

    const result = await service.inspect(
      42,
      fileRecord(bytes),
      parseJimakuVideoIdentity('Title - 07.mkv'),
      false
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.members).toHaveLength(2)
    expect(result.value.members[0].memberId).not.toBe(result.value.members[1].memberId)
    await service.prepareMember(result.value.packageHandle, result.value.members[1].memberId)
    expect(calls.extracted[0]).toEqual({ name: 'Title - 07.srt', bytes: second })
  })

  it('shows all supported members for movies without episode exclusion', async () => {
    const bytes = zipSync({ 'Movie - 01.srt': SRT_BYTES, 'Movie - 02.srt': SRT_BYTES })
    const { service } = makeService(bytes)

    const result = await service.inspect(
      42,
      fileRecord(bytes),
      parseJimakuVideoIdentity('Movie (2024).mkv'),
      true
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.members.every((member) => member.status !== 'excluded')).toBe(true)
  })

  it('returns a specific unsupportedArchive result for packs without supported subtitles', async () => {
    const bytes = zipSync({ 'readme.txt': strToU8('no subtitles'), 'nested.7z': strToU8('data') })
    const { service, released } = makeService(bytes)

    await expect(
      service.inspect(42, fileRecord(bytes), parseJimakuVideoIdentity('Title - 07.mkv'), false)
    ).resolves.toEqual({ ok: false, error: { code: 'unsupportedArchive' } })
    expect(released).toEqual(['store-package-1'])
  })

  it.each([
    ['truncated', new Uint8Array([1, 2, 3])],
    ['empty', new Uint8Array()]
  ])('rejects %s archives without a usable package handle', async (_label, bytes) => {
    const { service, released } = makeService(bytes)

    await expect(
      service.inspect(42, fileRecord(bytes), parseJimakuVideoIdentity('Title - 07.mkv'), false)
    ).resolves.toEqual({ ok: false, error: { code: 'invalidArchive' } })
    expect(released).toEqual(['store-package-1'])
  })

  it.each([
    ['absolute path', zipSync({ '/Title - 07.srt': SRT_BYTES })],
    ['drive path', zipSync({ 'C:/Title - 07.srt': SRT_BYTES })],
    ['backslash traversal', zipSync({ '..\\Title - 07.srt': SRT_BYTES })],
    [
      'encrypted',
      mutateCentral(zipSync({ 'Title - 07.srt': SRT_BYTES }), (data, offset) => {
        writeU16(data, offset + 8, 1)
      })
    ],
    [
      'symlink',
      mutateCentral(zipSync({ 'Title - 07.srt': SRT_BYTES }), (data, offset) => {
        writeU16(data, offset + 4, 3 << 8)
        writeU32(data, offset + 38, 0xa000 << 16)
      })
    ],
    [
      'unsupported compression',
      mutateCentral(zipSync({ 'Title - 07.srt': SRT_BYTES }), (data, offset) => {
        writeU16(data, offset + 10, 99)
      })
    ]
  ])('rejects %s members as unsupported archives', async (_label, bytes) => {
    const { service } = makeService(bytes)

    await expect(
      service.inspect(42, fileRecord(bytes), parseJimakuVideoIdentity('Title - 07.mkv'), false)
    ).resolves.toEqual({ ok: false, error: { code: 'unsupportedArchive' } })
  })

  it('enforces declared and actual expanded limits before returning a package', async () => {
    const bytes = zipSync({ 'Title - 07.srt': new Uint8Array(20) })
    const { service } = makeService(bytes, { maxExpandedBytes: 10 })
    await expect(
      service.inspect(42, fileRecord(bytes), parseJimakuVideoIdentity('Title - 07.mkv'), false)
    ).resolves.toEqual({ ok: false, error: { code: 'tooLarge' } })

    const actualLimitBytes = zipSync({ 'Title - 07.srt': new Uint8Array(20) })
    const lyingHeader = mutateCentral(actualLimitBytes, (data, offset) => {
      writeU32(data, offset + 24, 1)
      writeU32(data, readU32(data, offset + 42) + 22, 1)
    })
    const actual = makeService(lyingHeader, { maxExpandedBytes: 10 })
    await expect(
      actual.service.inspect(
        42,
        fileRecord(lyingHeader),
        parseJimakuVideoIdentity('Title - 07.mkv'),
        false
      )
    ).resolves.toEqual({ ok: false, error: { code: 'tooLarge' } })
  })

  it('marks an oversized member and refuses extraction at the selected-member limit', async () => {
    const bytes = zipSync({ 'Title - 07.srt': SRT_BYTES })
    const { service } = makeService(bytes, { maxMemberBytes: 4 })
    const result = await service.inspect(
      42,
      fileRecord(bytes),
      parseJimakuVideoIdentity('Title - 07.mkv'),
      false
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.members[0]).toMatchObject({
      status: 'browseOnly',
      reasons: expect.arrayContaining(['Declared subtitle size exceeds limit'])
    })
    await expect(
      service.prepareMember(result.value.packageHandle, result.value.members[0].memberId)
    ).resolves.toEqual({ ok: false, error: { code: 'tooLarge' } })
  })

  it('honors an already-aborted inspection or member operation', async () => {
    const bytes = zipSync({ 'Title - 07.srt': SRT_BYTES })
    const { service } = makeService(bytes)
    const controller = new AbortController()
    controller.abort()

    await expect(
      service.inspect(
        42,
        fileRecord(bytes),
        parseJimakuVideoIdentity('Title - 07.mkv'),
        false,
        controller.signal
      )
    ).resolves.toEqual({ ok: false, error: { code: 'cancelled' } })
  })
})
