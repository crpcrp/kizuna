// Resolves bundled-binary paths for development and packaged runs.
//
// The logical resources layout is shared by Windows and Linux:
//   resources/mpv/{mpv.exe|mpv}
//   resources/ffmpeg/{ffmpeg.exe|ffmpeg,ffprobe.exe|ffprobe}
//   resources/mecab/...
//
// MeCab is the one component whose internal layout differs. Windows is flat
// (`mecab/mecab.exe` beside `mecab/libmecab.dll`). The Linux payload ships a
// POSIX wrapper that resolves its shared library as `../lib` and its config as
// `../etc/mecabrc`, both relative to the wrapper's own directory, so the
// vendor's `bin/`, `lib/`, `etc/` tree is staged verbatim
// (`mecab/bin/mecab`). Flattening it silently breaks tokenization: the wrapper
// still starts, then `mecab.bin` fails to load `libmecab.so.2`.
//
// Unpackaged Linux development continues to use distribution tools. Packaged
// Linux resolves the staged vendor payload so it never depends on a host tool
// path.

import { posix, win32 } from 'node:path'
import { pathApiFor } from './platformPath'

export interface BinaryPaths {
  mpvPath: string
  ffprobePath: string
  ffmpegPath: string
  mecabPath: string
  ipadicDir: string
  /** Optional - only present if bundled; UniDic may also be user-configured. */
  unidicDir: string
}

export interface ResolveBinaryPathsOptions {
  /** Electron's app.isPackaged. */
  isPackaged: boolean
  /** Electron's process.resourcesPath (only meaningful when packaged). */
  resourcesPath: string
  /** Project root in development (only meaningful when not packaged). */
  appRoot: string
  /** Defaults to the host platform. Only Windows and Linux are supported. */
  platform?: NodeJS.Platform
}

export interface RequiredPackagedResource {
  label: string
  path: string
  kind: 'file' | 'directory'
}

export interface ResolveThirdPartyNoticesPathOptions {
  /** Electron's app.isPackaged. */
  isPackaged: boolean
  /** Electron's process.resourcesPath. */
  resourcesPath: string
  /** Project root in development. */
  appRoot: string
  platform?: NodeJS.Platform
}

/** Resolves the mutable UniDic folder owned by the user's app-data directory. */
export function resolveUserUnidicDir(
  userDataPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  return pathApiFor(platform).join(userDataPath, 'mecab', 'unidic')
}

/** Resolves the notices file generated for development or copied into a build. */
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

/** Pure. Lists the runtime files required by a packaged platform target. */
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
  // The component root: `<resources>/mecab` on both platforms. Linux's
  // executable sits one level deeper, in the payload's own `bin/`.
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
    // Game OCR's payload is Windows-only and arrives from the same vendor
    // archive, so the packaged smoke check covers it too: an installer that
    // shipped without the worker or a model file fails the release build
    // rather than the first capture.
    const gameOcr = resolveGameOcrPaths({
      isPackaged: true,
      resourcesPath,
      appRoot: '',
      platform
    })
    required.push({ label: 'PaddleOCR worker', path: gameOcr.workerPath, kind: 'file' })
    for (const [label, directory] of [
      ['detection', gameOcr.detectionModelDir],
      ['recognition', gameOcr.recognitionModelDir]
    ] as const) {
      // The worker refuses to start unless all three are beside each other.
      for (const name of ['inference.json', 'inference.pdiparams', 'inference.yml']) {
        required.push({
          label: `PaddleOCR ${label} model ${name}`,
          path: win32.join(directory, name),
          kind: 'file'
        })
      }
    }
  }
  return required
}

/**
 * The Windows-only Game OCR payload. It is staged into `resources/paddleocr`
 * by the same vendor pipeline that stages mpv, FFmpeg, and MeCab, and
 * electron-builder copies it from `win.extraResources` only, so a Linux
 * artifact never contains it and these paths never exist there.
 */
export interface GameOcrPaths {
  /** The PaddleOCR sidecar the worker adapter spawns. */
  workerPath: string
  /** Japanese detection model directory passed to the sidecar. */
  detectionModelDir: string
  /** Japanese recognition model directory passed to the sidecar. */
  recognitionModelDir: string
}

/** Pure. Resolves the Game OCR payload for a run mode. Windows only. */
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
  const base = win32.join(root, 'paddleocr')
  return {
    workerPath: win32.join(base, 'paddleocr.exe'),
    detectionModelDir: win32.join(base, 'models', 'det'),
    recognitionModelDir: win32.join(base, 'models', 'rec')
  }
}

/** Pure. Lists what must be on disk before Game OCR spawns its worker. */
export function requiredGameOcrResources(paths: GameOcrPaths): RequiredPackagedResource[] {
  return [
    { label: 'PaddleOCR worker', path: paths.workerPath, kind: 'file' },
    { label: 'PaddleOCR detection model', path: paths.detectionModelDir, kind: 'directory' },
    { label: 'PaddleOCR recognition model', path: paths.recognitionModelDir, kind: 'directory' }
  ]
}

/** What a probe found at a path; `missing` also covers an unreadable entry. */
export type ResourceKindProbe = (path: string) => 'file' | 'directory' | 'missing'

/**
 * Pure. Describes the first unusable resource so a caller can surface it as a
 * recoverable status error instead of letting a spawn fail with errno text.
 */
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

/** Pure. Resolves runtime binary paths for the given run mode and platform. */
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
  // See the header note: Linux runs the payload's relative-loader wrapper from
  // its own `bin/`, Windows the flat executable.
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
