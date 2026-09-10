import { describe, expect, it, vi } from 'vitest'
import {
  exportManagedJimakuSubtitle,
  type JimakuExportFs,
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

function makeFs(
  stat: JimakuExportFs['stat'] = async () => {
    throw errorWithCode('ENOENT')
  }
) {
  return {
    stat: vi.fn(stat),
    writeFile: vi.fn<JimakuExportFs['writeFile']>(async () => undefined)
  }
}

describe.each(PATH_PLATFORMS)(
  'Jimaku subtitle export on $label',
  ({ platform, path, mediaDir }) => {
    it.each(['srt', 'ass', 'ssa'] as const)(
      'uses the original .%s bytes and native save options',
      async (format) => {
        const mediaPath = path.join(mediaDir, 'Show.mkv')
        const destination = path.join(mediaDir, `Show.ja.${format}`)
        const fs = makeFs()
        const showSaveDialog = vi.fn<ShowJimakuSaveDialog>(async () => ({
          canceled: false,
          filePath: destination
        }))

        const result = await exportManagedJimakuSubtitle(request(mediaPath, format), {
          readSource: async () => source(format),
          isCurrent: () => true,
          isActive: () => true,
          showSaveDialog,
          fs,
          platform
        })

        expect(result).toEqual({ status: 'exported', path: destination })
        expect(showSaveDialog).toHaveBeenCalledWith({
          defaultPath: destination,
          filters: [{ name: 'Subtitles', extensions: [format] }],
          properties: ['showOverwriteConfirmation']
        })
        expect(fs.writeFile).toHaveBeenCalledWith(destination, BYTES, { flag: 'wx' })
      }
    )

    it('cancels without checking or writing when the dialog is cancelled', async () => {
      const fs = makeFs()
      const result = await exportManagedJimakuSubtitle(request(path.join(mediaDir, 'Show.mkv')), {
        readSource: async () => source(),
        isCurrent: () => true,
        isActive: () => true,
        showSaveDialog: async () => ({ canceled: true }),
        fs,
        platform
      })

      expect(result).toEqual({ status: 'cancelled' })
      expect(fs.stat).not.toHaveBeenCalled()
      expect(fs.writeFile).not.toHaveBeenCalled()
    })

    it('writes an existing file only after native overwrite confirmation', async () => {
      const destination = path.join(mediaDir, 'Show.ja.srt')
      const fs = makeFs(async () => ({ isFile: true }))
      const showSaveDialog = vi.fn<ShowJimakuSaveDialog>(async () => ({
        canceled: false,
        filePath: destination
      }))

      const result = await exportManagedJimakuSubtitle(request(path.join(mediaDir, 'Show.mkv')), {
        readSource: async () => source(),
        isCurrent: () => true,
        isActive: () => true,
        showSaveDialog,
        fs,
        platform
      })

      expect(result).toEqual({ status: 'exported', path: destination })
      expect(showSaveDialog.mock.calls[0]?.[0]?.properties).toEqual(['showOverwriteConfirmation'])
      expect(fs.writeFile).toHaveBeenCalledWith(destination, BYTES, { flag: 'w' })
    })

    it('does not clobber a destination that appears after the dialog', async () => {
      const destination = path.join(mediaDir, 'Show.ja.srt')
      const fs = makeFs()
      fs.writeFile.mockRejectedValueOnce(errorWithCode('EEXIST'))

      const result = await exportManagedJimakuSubtitle(request(path.join(mediaDir, 'Show.mkv')), {
        readSource: async () => source(),
        isCurrent: () => true,
        isActive: () => true,
        showSaveDialog: async () => ({ canceled: false, filePath: destination }),
        fs,
        platform
      })

      expect(result).toEqual({ status: 'error', code: 'destinationChanged' })
      expect(fs.writeFile).toHaveBeenCalledWith(destination, BYTES, { flag: 'wx' })
    })
  }
)

describe('Jimaku subtitle export validation', () => {
  const mediaPath = '/media/Show.mkv'
  const destination = '/media/Show.ja.srt'
  const base = {
    readSource: async () => source(),
    isCurrent: () => true,
    isActive: () => true,
    showSaveDialog: async () => ({ canceled: false, filePath: destination }),
    fs: makeFs(),
    platform: 'linux' as const
  }

  it('refuses source=destination and nonregular destinations', async () => {
    const same = await exportManagedJimakuSubtitle(request(mediaPath), {
      ...base,
      showSaveDialog: async () => ({ canceled: false, filePath: source().path })
    })
    expect(same).toEqual({ status: 'error', code: 'invalidDestination' })
    expect(base.fs.writeFile).not.toHaveBeenCalled()

    const nonregularFs = makeFs(async () => ({ isFile: false }))
    const nonregular = await exportManagedJimakuSubtitle(request(mediaPath), {
      ...base,
      fs: nonregularFs
    })
    expect(nonregular).toEqual({ status: 'error', code: 'invalidDestination' })
    expect(nonregularFs.writeFile).not.toHaveBeenCalled()
  })

  it('reports missing sources and storage failures without writing', async () => {
    const missing = await exportManagedJimakuSubtitle(request(mediaPath), {
      ...base,
      readSource: async () => undefined
    })
    expect(missing).toEqual({ status: 'error', code: 'notAvailable' })

    const permissionFs = makeFs(async () => {
      throw errorWithCode('EACCES')
    })
    const permission = await exportManagedJimakuSubtitle(request(mediaPath), {
      ...base,
      fs: permissionFs
    })
    expect(permission).toEqual({ status: 'error', code: 'storage' })
    expect(permissionFs.writeFile).not.toHaveBeenCalled()
  })

  it('cancels when media or selection changes while the dialog is open', async () => {
    const dialog = deferred<{ canceled: boolean; filePath?: string }>()
    let current = true
    let active = true
    const fs = makeFs()
    const showSaveDialog = vi.fn<ShowJimakuSaveDialog>(() => dialog.promise)
    const pending = exportManagedJimakuSubtitle(request(mediaPath), {
      ...base,
      fs,
      isCurrent: () => current,
      isActive: () => active,
      showSaveDialog
    })

    await vi.waitFor(() => expect(showSaveDialog).toHaveBeenCalled())
    current = false
    dialog.resolve({ canceled: false, filePath: destination })
    await expect(pending).resolves.toEqual({ status: 'cancelled' })
    expect(fs.writeFile).not.toHaveBeenCalled()

    const secondDialog = deferred<{ canceled: boolean; filePath?: string }>()
    current = true
    const secondShowSaveDialog = vi.fn<ShowJimakuSaveDialog>(() => secondDialog.promise)
    const second = exportManagedJimakuSubtitle(request(mediaPath), {
      ...base,
      fs,
      isCurrent: () => current,
      isActive: () => active,
      showSaveDialog: secondShowSaveDialog
    })
    await vi.waitFor(() => expect(secondShowSaveDialog).toHaveBeenCalled())
    active = false
    secondDialog.resolve({ canceled: false, filePath: destination })
    await expect(second).resolves.toEqual({ status: 'cancelled' })
    expect(fs.writeFile).not.toHaveBeenCalled()
  })
})
