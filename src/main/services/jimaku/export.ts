import { stat, writeFile } from 'node:fs/promises'
import type { SaveDialogOptions } from 'electron'
import { isRemoteUrl } from '../../../shared/mediaFileTypes'
import { pathApiFor } from '../../platformPath'
import type {
  JimakuSubtitleExportRequest,
  JimakuSubtitleExportResult
} from '../../../shared/jimaku'
import type { JimakuManagedSubtitle } from './downloadStore'

export type JimakuSaveDialogOptions = Pick<
  SaveDialogOptions,
  'defaultPath' | 'filters' | 'properties'
>

export type ShowJimakuSaveDialog = (
  options: JimakuSaveDialogOptions
) => Promise<{ canceled: boolean; filePath?: string }>

export interface JimakuExportFs {
  stat(path: string): Promise<{ isFile: boolean }>
  writeFile(path: string, bytes: Uint8Array, options: { flag: 'w' | 'wx' }): Promise<void>
}

export const nodeJimakuExportFs: JimakuExportFs = {
  stat: async (path) => ({ isFile: (await stat(path)).isFile() }),
  writeFile: (path, bytes, options) => writeFile(path, bytes, options)
}

export interface JimakuSubtitleExportDeps {
  readSource(): Promise<JimakuManagedSubtitle | undefined>
  isCurrent(): boolean
  isActive(): boolean
  showSaveDialog: ShowJimakuSaveDialog
  fs?: JimakuExportFs
  platform?: NodeJS.Platform
}

export async function exportManagedJimakuSubtitle(
  request: JimakuSubtitleExportRequest,
  deps: JimakuSubtitleExportDeps
): Promise<JimakuSubtitleExportResult> {
  if (!deps.isCurrent()) return { status: 'error', code: 'staleMedia' }
  if (!deps.isActive()) return { status: 'error', code: 'notAvailable' }

  const source = await deps.readSource().catch(() => undefined)
  if (!deps.isCurrent() || !deps.isActive()) return { status: 'cancelled' }
  if (!source) return { status: 'error', code: 'notAvailable' }

  const pathApi = pathApiFor(deps.platform)
  const parsed = pathApi.parse(request.mediaPath)
  const defaultPath = pathApi.join(parsed.dir, `${parsed.name}.ja.${source.format}`)
  let result: { canceled: boolean; filePath?: string }
  try {
    result = await deps.showSaveDialog({
      defaultPath,
      filters: [{ name: 'Subtitles', extensions: [source.format] }],
      // The native dialog owns overwrite consent. The write below uses an
      // exclusive flag when the destination was absent after the dialog.
      properties: ['showOverwriteConfirmation']
    })
  } catch {
    return { status: 'error', code: 'storage' }
  }
  if (result.canceled || !result.filePath) return { status: 'cancelled' }
  if (!deps.isCurrent() || !deps.isActive()) return { status: 'cancelled' }

  const destination = result.filePath
  if (typeof destination !== 'string' || destination.trim() === '' || isRemoteUrl(destination)) {
    return { status: 'error', code: 'invalidDestination' }
  }
  if (samePath(source.path, destination, deps.platform)) {
    return { status: 'error', code: 'invalidDestination' }
  }

  if (!deps.isCurrent() || !deps.isActive()) return { status: 'cancelled' }
  const latest = await deps.readSource().catch(() => undefined)
  if (!deps.isCurrent() || !deps.isActive()) return { status: 'cancelled' }
  if (!latest || latest.path !== source.path || latest.format !== source.format) {
    return { status: 'error', code: 'notAvailable' }
  }

  const fs = deps.fs ?? nodeJimakuExportFs
  let overwrite = false
  try {
    const target = await fs.stat(destination)
    if (!target.isFile) return { status: 'error', code: 'invalidDestination' }
    overwrite = true
  } catch (error) {
    if (!isMissing(error)) return { status: 'error', code: 'storage' }
  }
  if (!deps.isCurrent() || !deps.isActive()) return { status: 'cancelled' }

  try {
    await fs.writeFile(destination, latest.bytes, { flag: overwrite ? 'w' : 'wx' })
  } catch (error) {
    if (!overwrite && errorCode(error) === 'EEXIST') {
      return { status: 'error', code: 'destinationChanged' }
    }
    return { status: 'error', code: 'storage' }
  }
  return { status: 'exported', path: destination }
}

function samePath(left: string, right: string, platform: NodeJS.Platform | undefined): boolean {
  const pathApi = pathApiFor(platform)
  const canonical = (value: string): string => {
    const resolved = pathApi.resolve(value)
    return (platform ?? process.platform) === 'win32' ? resolved.toLowerCase() : resolved
  }
  return canonical(left) === canonical(right)
}

function errorCode(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR'
}
