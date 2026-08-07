// Resolves bundled-binary paths for dev vs packaged runs, replacing the
// temporary KIZUNA_MPV_PATH / KIZUNA_FFPROBE_PATH / KIZUNA_FFMPEG_PATH
// env-var hooks in index.ts and mediaService.ts.
//
// Packaged (electron-builder extraResources, see package.json "build"):
//   <resourcesPath>/mpv/{mpv[.exe]}
//   <resourcesPath>/ffmpeg/{ffmpeg,ffprobe}[.exe]
//   <resourcesPath>/mecab/mecab[.exe], /mecab/ipadic, /mecab/unidic
//   <resourcesPath>/yt-dlp/yt-dlp[.exe]
// Dev (binaries checked out locally, gitignored — see resources/):
//   <appRoot>/resources/mpv/{mpv[.exe]}
//   <appRoot>/resources/ffmpeg/{ffmpeg,ffprobe}[.exe]
//   <appRoot>/resources/mecab/mecab[.exe], /mecab/ipadic, /mecab/unidic
//   <appRoot>/resources/yt-dlp/yt-dlp[.exe]
// Both layouts mirror each other so this is a single join per binary.

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

function executableName(name: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return `${name}.exe`
  if (platform === 'linux') return name
  throw new Error(`Unsupported platform for resource paths: ${platform}`)
}

/** Pure. Lists the runtime files and layout that must exist in an installer. */
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
  // Linux development uses Ubuntu's distribution packages under /usr/bin. The checked-in
  // resource lock currently stages Windows binaries only, and trying to join
  // extensionless names under that tree leaves every Linux checkout pointing
  // at files which cannot exist. Packaged Linux builds retain the mirrored
  // resources layout so a future AppImage/deb remains self-contained.
  if (platform === 'linux' && !isPackaged) {
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
  const executable = (name: string): string => executableName(name, platform)
  const base = isPackaged ? resourcesPath : join(appRoot, 'resources')
  return {
    mpvPath: join(base, 'mpv', executable('mpv')),
    ffprobePath: join(base, 'ffmpeg', executable('ffprobe')),
    ffmpegPath: join(base, 'ffmpeg', executable('ffmpeg')),
    mecabPath: join(base, 'mecab', executable('mecab')),
    ipadicDir: join(base, 'mecab', 'ipadic'),
    unidicDir: join(base, 'mecab', 'unidic'),
    ytdlpPath: join(base, 'yt-dlp', executable('yt-dlp'))
  }
}
