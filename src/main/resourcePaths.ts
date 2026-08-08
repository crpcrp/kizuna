// Resolves bundled-binary paths for dev vs packaged runs, replacing the
// temporary KIZUNA_MPV_PATH / KIZUNA_FFPROBE_PATH / KIZUNA_FFMPEG_PATH
// env-var hooks in index.ts and mediaService.ts.
//
// Packaged Windows uses electron-builder's resources layout; Windows
// development mirrors it under <appRoot>/resources. Linux development uses
// distribution binaries and dictionaries directly.

import { join } from 'node:path'

export interface BinaryPaths {
  mpvPath: string
  ffprobePath: string
  ffmpegPath: string
  mecabPath: string
  ipadicDir: string
  /** Optional — only present if bundled; UniDic may also be user-configured. */
  unidicDir: string
  /** yt-dlp, for mpv's ytdl hook (network streaming). Bundled under
   * `resources/yt-dlp/`; the arg is only emitted when the file actually exists. */
  ytdlpPath: string
}

export interface ResolveBinaryPathsOptions {
  /** Electron's `app.isPackaged`. */
  isPackaged: boolean
  /** Electron's `process.resourcesPath` (only meaningful when packaged). */
  resourcesPath: string
  /** Project root in dev (only meaningful when not packaged). */
  appRoot: string
  /** Defaults to the host platform. Only Windows and Linux are supported. */
  platform?: NodeJS.Platform
}

export interface RequiredPackagedResource {
  label: string
  path: string
  kind: 'file' | 'directory'
}

/** Pure. Lists the runtime files required by the supported Windows installer. */
export function requiredPackagedResources(resourcesPath: string): RequiredPackagedResource[] {
  const paths = resolveBinaryPaths({
    isPackaged: true,
    resourcesPath,
    appRoot: '',
    platform: 'win32'
  })
  return [
    { label: 'mpv', path: paths.mpvPath, kind: 'file' },
    { label: 'ffmpeg', path: paths.ffmpegPath, kind: 'file' },
    { label: 'ffprobe', path: paths.ffprobePath, kind: 'file' },
    { label: 'MeCab', path: paths.mecabPath, kind: 'file' },
    { label: 'MeCab IPADIC', path: paths.ipadicDir, kind: 'directory' }
  ]
}

/** Pure. Resolves runtime binary paths for the given run mode and platform. */
export function resolveBinaryPaths({
  isPackaged,
  resourcesPath,
  appRoot,
  platform = process.platform
}: ResolveBinaryPathsOptions): BinaryPaths {
  if (platform === 'linux') {
    if (isPackaged) throw new Error('Packaged Linux builds are not supported')
    return {
      mpvPath: '/usr/bin/mpv',
      ffprobePath: '/usr/bin/ffprobe',
      ffmpegPath: '/usr/bin/ffmpeg',
      mecabPath: '/usr/bin/mecab',
      ipadicDir: '/var/lib/mecab/dic/debian',
      unidicDir: '/usr/share/mecab/dic/unidic',
      ytdlpPath: '/usr/bin/yt-dlp'
    }
  }
  if (platform !== 'win32') {
    throw new Error(`Unsupported platform for resource paths: ${platform}`)
  }
  const base = isPackaged ? resourcesPath : join(appRoot, 'resources')
  return {
    mpvPath: join(base, 'mpv', 'mpv.exe'),
    ffprobePath: join(base, 'ffmpeg', 'ffprobe.exe'),
    ffmpegPath: join(base, 'ffmpeg', 'ffmpeg.exe'),
    mecabPath: join(base, 'mecab', 'mecab.exe'),
    ipadicDir: join(base, 'mecab', 'ipadic'),
    unidicDir: join(base, 'mecab', 'unidic'),
    ytdlpPath: join(base, 'yt-dlp', 'yt-dlp.exe')
  }
}
