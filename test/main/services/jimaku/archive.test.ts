import { strToU8, zipSync } from 'fflate'
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

function firstCentralOffset(bytes: Uint8Array): number {
  for (let offset = 0; offset + 4 <= bytes.length; offset += 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x01 &&
      bytes[offset + 3] === 0x02
    ) {
      return offset
    }
  }
  throw new Error('central directory not found')
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
      'unsupported compression',
      (() => {
        const data = zipSync({ 'Title - 07.srt': SRT_BYTES })
        const offset = firstCentralOffset(data)
        data[offset + 10] = 99
        data[offset + 11] = 0
        return data
      })()
    ]
  ])('rejects %s members as unsupported archives', async (_label, bytes) => {
    const { service } = makeService(bytes)

    await expect(
      service.inspect(42, fileRecord(bytes), parseJimakuVideoIdentity('Title - 07.mkv'), false)
    ).resolves.toEqual({ ok: false, error: { code: 'unsupportedArchive' } })
  })

  it('enforces the total expanded limit across subtitle members', async () => {
    const bytes = zipSync({
      'Title - 07.srt': new Uint8Array(8),
      'Title - 08.srt': new Uint8Array(8),
      'large.bin': new Uint8Array(100)
    })
    const { service, released } = makeService(bytes, { maxExpandedBytes: 12 })

    await expect(
      service.inspect(42, fileRecord(bytes), parseJimakuVideoIdentity('Title - 07.mkv'), false)
    ).resolves.toEqual({ ok: false, error: { code: 'tooLarge' } })
    expect(released).toEqual(['store-package-1'])
  })

  it('rejects an archive with an oversized subtitle member', async () => {
    const bytes = zipSync({ 'Title - 07.srt': SRT_BYTES })
    const { service } = makeService(bytes, { maxMemberBytes: 4 })

    await expect(
      service.inspect(42, fileRecord(bytes), parseJimakuVideoIdentity('Title - 07.mkv'), false)
    ).resolves.toEqual({ ok: false, error: { code: 'tooLarge' } })
  })

  it('rechecks stored member sizes after extraction when headers understate them', async () => {
    const bytes = zipSync({ 'Title - 07.srt': new Uint8Array(20) }, { level: 0 })
    const offset = firstCentralOffset(bytes)
    bytes.set([1, 0, 0, 0], offset + 24)
    const { service } = makeService(bytes, { maxMemberBytes: 10 })

    await expect(
      service.inspect(42, fileRecord(bytes), parseJimakuVideoIdentity('Title - 07.mkv'), false)
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
