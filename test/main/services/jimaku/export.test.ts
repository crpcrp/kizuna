import disk from 'node:fs'
import diskAsync from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const tempDirs: string[] = []
function tempDir(): string {
  const dir = disk.mkdtempSync(join(tmpdir(), 'kizuna-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const dir of tempDirs.splice(0)) disk.rmSync(dir, { recursive: true, force: true })
})
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  exportManagedJimakuSubtitle,
  type ShowJimakuSaveDialog
} from '@src/main/services/jimaku/export'
import type { JimakuSubtitleExportRequest } from '@src/shared/jimaku'
import { PATH_PLATFORMS } from '@test/harness/platformPaths'
import { deferred } from '@test/harness/deferred'

const BYTES = new Uint8Array([0, 255, 10, 13, 0, 1])
const CONTENT_VERSION = 'a'.repeat(64)

function errorWithCode(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

function request(
  mediaPath: string,
  format: 'srt' | 'ass' | 'ssa' = 'srt'
): JimakuSubtitleExportRequest {
  return {
    mediaPath,
    mediaGeneration: 3,
    provenance: {
      provider: 'jimaku',
      entryId: 42,
      fileName: `episode.${format}`,
      contentVersion: CONTENT_VERSION
    }
  }
}

function source(format: 'srt' | 'ass' | 'ssa' = 'srt') {
  return { path: `/cache/${CONTENT_VERSION}.${format}`, bytes: BYTES, format }
}

function fixture() {
  const dir = tempDir()
  const destination = join(dir, 'Show.ja.srt')
  const showSaveDialog = vi.fn<ShowJimakuSaveDialog>(async () => ({
    canceled: false,
    filePath: destination
  }))
  return {
    destination,
    showSaveDialog,
    deps: {
      readSource: async () => source(),
      isCurrent: () => true,
      isActive: () => true,
      showSaveDialog
    }
  }
}

describe.each(PATH_PLATFORMS)('save default on $label', ({ platform, path, mediaDir }) => {
  it.each(['srt', 'ass', 'ssa'] as const)('suggests a matching .%s path', async (format) => {
    const showSaveDialog = vi.fn<ShowJimakuSaveDialog>(async () => ({ canceled: true }))
    await expect(
      exportManagedJimakuSubtitle(request(path.join(mediaDir, 'Show.mkv'), format), {
        readSource: async () => source(format),
        isCurrent: () => true,
        isActive: () => true,
        showSaveDialog,
        platform
      })
    ).resolves.toEqual({ status: 'cancelled' })
    expect(showSaveDialog).toHaveBeenCalledWith({
      defaultPath: path.join(mediaDir, `Show.ja.${format}`),
      filters: [{ name: 'Subtitles', extensions: [format] }],
      properties: ['showOverwriteConfirmation']
    })
  })
})

describe('subtitle export on disk', () => {
  it('writes the original bytes and overwrites after native consent', async () => {
    const f = fixture()
    for (let i = 0; i < 2; i++) {
      await expect(
        exportManagedJimakuSubtitle(request(join(tempDir(), 'Show.mkv')), f.deps)
      ).resolves.toEqual({ status: 'exported', path: f.destination })
      expect(new Uint8Array(disk.readFileSync(f.destination))).toEqual(BYTES)
    }
  })

  it('does not clobber a file appearing after the destination check', async () => {
    const f = fixture()
    const write = diskAsync.writeFile
    vi.spyOn(diskAsync, 'writeFile').mockImplementationOnce(async (path, bytes, options) => {
      disk.writeFileSync(f.destination, 'other writer')
      return write(path, bytes, options)
    })
    await expect(exportManagedJimakuSubtitle(request('/media/Show.mkv'), f.deps)).resolves.toEqual({
      status: 'error',
      code: 'destinationChanged'
    })
    expect(disk.readFileSync(f.destination, 'utf-8')).toBe('other writer')
  })

  it('refuses source=destination and directory destinations', async () => {
    const f = fixture()
    f.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: source().path })
    await expect(exportManagedJimakuSubtitle(request('/media/Show.mkv'), f.deps)).resolves.toEqual({
      status: 'error',
      code: 'invalidDestination'
    })
    disk.mkdirSync(f.destination)
    await expect(exportManagedJimakuSubtitle(request('/media/Show.mkv'), f.deps)).resolves.toEqual({
      status: 'error',
      code: 'invalidDestination'
    })
  })

  it('reports missing sources and storage failures without creating a destination', async () => {
    const f = fixture()
    await expect(
      exportManagedJimakuSubtitle(request('/media/Show.mkv'), {
        ...f.deps,
        readSource: async () => undefined
      })
    ).resolves.toEqual({ status: 'error', code: 'notAvailable' })
    vi.spyOn(diskAsync, 'stat').mockRejectedValueOnce(errorWithCode('EACCES'))
    await expect(exportManagedJimakuSubtitle(request('/media/Show.mkv'), f.deps)).resolves.toEqual({
      status: 'error',
      code: 'storage'
    })
    expect(disk.existsSync(f.destination)).toBe(false)
  })

  it.each(['media', 'selection'])(
    'cancels if %s changes while the dialog is open',
    async (change) => {
      const f = fixture()
      const dialog = deferred<{ canceled: boolean; filePath?: string }>()
      let current = true
      f.showSaveDialog.mockReturnValueOnce(dialog.promise)
      const pending = exportManagedJimakuSubtitle(request('/media/Show.mkv'), {
        ...f.deps,
        isCurrent: () => (change === 'media' ? current : true),
        isActive: () => (change === 'selection' ? current : true)
      })
      await vi.waitFor(() => expect(f.showSaveDialog).toHaveBeenCalled())
      current = false
      dialog.resolve({ canceled: false, filePath: f.destination })
      await expect(pending).resolves.toEqual({ status: 'cancelled' })
      expect(disk.existsSync(f.destination)).toBe(false)
    }
  )
})
