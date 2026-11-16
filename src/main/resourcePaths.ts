// Linux MeCab needs its bin/lib/etc layout: the wrapper resolves ../lib and ../etc/mecabrc.
// Flattening it prevents mecab.bin from loading libmecab.so.2.

import { posix, win32 } from 'node:path'
import { pathApiFor } from './platformPath'

export interface BinaryPaths {
  mpvPath: string
  ffprobePath: string
  ffmpegPath: string
  mecabPath: string
  ipadicDir: string
  /** The resolved path may not exist unless UniDic is installed. */
  unidicDir: string
}

export interface ResolveBinaryPathsOptions {
  isPackaged: boolean
  /** Electron's process.resourcesPath (only meaningful when packaged). */
  resourcesPath: string
  /** Project root in development (only meaningful when not packaged). */
  appRoot: string
  platform?: NodeJS.Platform
}

export interface RequiredPackagedResource {
  label: string
  path: string
  kind: 'file' | 'directory'
}

export interface ResolveThirdPartyNoticesPathOptions {
  isPackaged: boolean
  /** Electron's process.resourcesPath. */
  resourcesPath: string
  /** Project root in development. */
  appRoot: string
  platform?: NodeJS.Platform
}

export function resolveUserUnidicDir(
  userDataPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  return pathApiFor(platform).join(userDataPath, 'mecab', 'unidic')
}

export function resolveThirdPartyNoticesPath({
  isPackaged,
  resourcesPath,
  appRoot,
  platform = process.platform
}: ResolveThirdPartyNoticesPathOptions): string {
  const pathApi = pathApiFor(platform)
  const base = isPackaged ? resourcesPath : pathApi.join(appRoot, 'build')
  return pathApi.join(base, 'notices', 'THIRD_PARTY_NOTICES.md')
}

export function requiredPackagedResources(
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform
): RequiredPackagedResource[] {
  const paths = resolveBinaryPaths({
    isPackaged: true,
    resourcesPath,
    appRoot: '',
    platform
  })
  const required: RequiredPackagedResource[] = [
    { label: 'mpv', path: paths.mpvPath, kind: 'file' },
    { label: 'ffmpeg', path: paths.ffmpegPath, kind: 'file' },
    { label: 'ffprobe', path: paths.ffprobePath, kind: 'file' },
    { label: 'MeCab', path: paths.mecabPath, kind: 'file' }
  ]
  const pathApi = platform === 'linux' ? posix : win32
  const mecabRoot =
    platform === 'linux'
      ? pathApi.dirname(pathApi.dirname(paths.mecabPath))
      : pathApi.dirname(paths.mecabPath)
  const ipadic = (name: string): RequiredPackagedResource => ({
    label: `MeCab IPADIC ${name}`,
    path: pathApi.join(paths.ipadicDir, name),
    kind: 'file'
  })
  if (platform === 'linux') {
    required.push(
      {
        label: 'MeCab executable',
        path: posix.join(mecabRoot, 'bin', 'mecab.bin'),
        kind: 'file'
      },
      // Resolved by the wrapper through LD_LIBRARY_PATH, not by the dynamic
      // loader's default search path, so both names must be present.
      {
        label: 'MeCab shared library',
        path: posix.join(mecabRoot, 'lib', 'libmecab.so.2'),
        kind: 'file'
      },
      {
        label: 'MeCab shared library payload',
        path: posix.join(mecabRoot, 'lib', 'libmecab.so.2.0.0'),
        kind: 'file'
      },
      {
        label: 'MeCab configuration',
        path: posix.join(mecabRoot, 'etc', 'mecabrc'),
        kind: 'file'
      },
      ipadic('char.bin'),
      ipadic('dicrc'),
      ipadic('matrix.bin'),
      ipadic('sys.dic'),
      ipadic('unk.dic')
    )
  } else {
    required.push(
      {
        label: 'MeCab shared library',
        path: win32.join(mecabRoot, 'libmecab.dll'),
        kind: 'file'
      },
      { label: 'MeCab configuration', path: win32.join(mecabRoot, 'mecabrc'), kind: 'file' },
      ipadic('sys.dic'),
      ipadic('matrix.bin'),
      ipadic('char.bin'),
      ipadic('unk.dic')
    )
    const gameOcr = resolveGameOcrPaths({
      isPackaged: true,
      resourcesPath,
      appRoot: '',
      platform
    })
    required.push(...requiredGameOcrResources(gameOcr))
  }
  return required
}

export interface GameOcrPaths {
  workerPath: string
  detectionModelPath: string
  recognitionModelPath: string
  /** Recognition dictionary extracted from the model metadata. */
  keysPath: string
}

export function resolveGameOcrPaths({
  isPackaged,
  resourcesPath,
  appRoot,
  platform = process.platform
}: ResolveBinaryPathsOptions): GameOcrPaths {
  if (platform !== 'win32') {
    throw new Error('Game OCR resources ship on Windows only, not ' + platform)
  }
  const root = isPackaged ? resourcesPath : win32.join(appRoot, 'resources')
  const base = win32.join(root, 'ppocr')
  return {
    workerPath: win32.join(base, 'ppocr.exe'),
    detectionModelPath: win32.join(base, 'models', 'det.onnx'),
    recognitionModelPath: win32.join(base, 'models', 'rec.onnx'),
    keysPath: win32.join(base, 'models', 'keys.txt')
  }
}

export function requiredGameOcrResources(paths: GameOcrPaths): RequiredPackagedResource[] {
  const runtimeRoot = win32.dirname(paths.workerPath)
  return [
    { label: 'PP-OCR ONNX worker', path: paths.workerPath, kind: 'file' },
    ...[
      'onnxruntime.dll',
      'onnxruntime_providers_shared.dll',
      'msvcp140.dll',
      'msvcp140_1.dll',
      'vcruntime140.dll',
      'vcruntime140_1.dll'
    ].map((name) => ({
      label: `PP-OCR runtime library ${name}`,
      path: win32.join(runtimeRoot, name),
      kind: 'file' as const
    })),
    { label: 'PP-OCR detection model', path: paths.detectionModelPath, kind: 'file' },
    { label: 'PP-OCR recognition model', path: paths.recognitionModelPath, kind: 'file' },
    { label: 'PP-OCR recognition dictionary', path: paths.keysPath, kind: 'file' }
  ]
}

/** What a probe found at a path; `missing` also covers an unreadable entry. */
export type ResourceKindProbe = (path: string) => 'file' | 'directory' | 'missing'

export function missingResourceMessage(
  resources: readonly RequiredPackagedResource[],
  probe: ResourceKindProbe
): string | undefined {
  for (const resource of resources) {
    const found = probe(resource.path)
    if (found === resource.kind) continue
    const detail = found === 'missing' ? 'is missing' : 'is not a ' + resource.kind
    return `The bundled ${resource.label} ${detail}: ${resource.path}. Reinstall Kizuna to restore it.`
  }
  return undefined
}

export function resolveBinaryPaths({
  isPackaged,
  resourcesPath,
  appRoot,
  platform = process.platform
}: ResolveBinaryPathsOptions): BinaryPaths {
  if (platform === 'linux' && !isPackaged) {
    return {
      mpvPath: '/usr/bin/mpv',
      ffprobePath: '/usr/bin/ffprobe',
      ffmpegPath: '/usr/bin/ffmpeg',
      mecabPath: '/usr/bin/mecab',
      ipadicDir: '/var/lib/mecab/dic/debian',
      unidicDir: '/usr/share/mecab/dic/unidic'
    }
  }
  if (platform !== 'win32' && platform !== 'linux') {
    throw new Error('Unsupported platform for resource paths: ' + platform)
  }

  const pathApi = platform === 'win32' ? win32 : posix
  const base = isPackaged ? resourcesPath : pathApi.join(appRoot, 'resources')
  const executable = platform === 'win32' ? 'mpv.exe' : 'mpv'
  const ffprobe = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const ffmpeg = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const mecabPath =
    platform === 'win32'
      ? pathApi.join(base, 'mecab', 'mecab.exe')
      : pathApi.join(base, 'mecab', 'bin', 'mecab')
  return {
    mpvPath: pathApi.join(base, 'mpv', executable),
    ffprobePath: pathApi.join(base, 'ffmpeg', ffprobe),
    ffmpegPath: pathApi.join(base, 'ffmpeg', ffmpeg),
    mecabPath,
    ipadicDir: pathApi.join(base, 'mecab', 'ipadic'),
    unidicDir: pathApi.join(base, 'mecab', 'unidic')
  }
}
