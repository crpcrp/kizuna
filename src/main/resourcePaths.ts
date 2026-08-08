// Resolves bundled-binary paths for development and packaged runs.
//
// The logical resources layout is shared by Windows and Linux:
//   resources/mpv/{mpv.exe|mpv}
//   resources/ffmpeg/{ffmpeg.exe|ffmpeg,ffprobe.exe|ffprobe}
//   resources/mecab/{mecab.exe|mecab,ipadic,...}
//
// Unpackaged Linux development continues to use distribution tools. Packaged
// Linux resolves the staged vendor payload so it never depends on a host tool
// path.

import { posix, win32 } from 'node:path'

export interface BinaryPaths {
  mpvPath: string
  ffprobePath: string
  ffmpegPath: string
  mecabPath: string
  ipadicDir: string
  /** Optional - only present if bundled; UniDic may also be user-configured. */
  unidicDir: string
  /** Optional yt-dlp path. The caller checks whether the file exists. */
  ytdlpPath: string
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
    { label: 'MeCab', path: paths.mecabPath, kind: 'file' },
    { label: 'MeCab IPADIC', path: paths.ipadicDir, kind: 'directory' }
  ]
  if (platform === 'linux') {
    const base = posix.dirname(posix.dirname(paths.mecabPath))
    required.splice(
      4,
      0,
      { label: 'MeCab executable', path: posix.join(base, 'mecab', 'mecab.bin'), kind: 'file' },
      {
        label: 'MeCab shared library',
        path: posix.join(base, 'mecab', 'lib', 'libmecab.so.2'),
        kind: 'file'
      },
      { label: 'MeCab configuration', path: posix.join(base, 'mecab', 'mecabrc'), kind: 'file' }
    )
  } else {
    const base = win32.dirname(win32.dirname(paths.mecabPath))
    required.splice(4, 0, {
      label: 'MeCab shared library',
      path: win32.join(base, 'mecab', 'libmecab.dll'),
      kind: 'file'
    })
  }
  return required
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
      unidicDir: '/usr/share/mecab/dic/unidic',
      ytdlpPath: '/usr/bin/yt-dlp'
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
  const mecab = platform === 'win32' ? 'mecab.exe' : 'mecab'
  const ytdlp = platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  return {
    mpvPath: pathApi.join(base, 'mpv', executable),
    ffprobePath: pathApi.join(base, 'ffmpeg', ffprobe),
    ffmpegPath: pathApi.join(base, 'ffmpeg', ffmpeg),
    mecabPath: pathApi.join(base, 'mecab', mecab),
    ipadicDir: pathApi.join(base, 'mecab', 'ipadic'),
    unidicDir: pathApi.join(base, 'mecab', 'unidic'),
    ytdlpPath: pathApi.join(base, 'yt-dlp', ytdlp)
  }
}
