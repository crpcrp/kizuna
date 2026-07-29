// Phase 1 · Task 7 (S15) — resolves bundled-binary paths for dev vs packaged
// runs, replacing the temporary KIZUNA_MPV_PATH / KIZUNA_FFPROBE_PATH /
// KIZUNA_FFMPEG_PATH env-var hooks in index.ts and mediaService.ts.
//
// Packaged (electron-builder extraResources, see package.json "build"):
//   <resourcesPath>/mpv/mpv.exe
//   <resourcesPath>/ffmpeg/{ffmpeg,ffprobe}.exe
//   <resourcesPath>/mecab/mecab.exe, /mecab/ipadic, /mecab/unidic (Phase 2)
//   <resourcesPath>/yt-dlp/yt-dlp.exe (Feature 9)
// Dev (binaries checked out locally, gitignored — see resources/):
//   <appRoot>/resources/mpv/mpv.exe
//   <appRoot>/resources/ffmpeg/{ffmpeg,ffprobe}.exe
//   <appRoot>/resources/mecab/mecab.exe, /mecab/ipadic, /mecab/unidic (Phase 2)
//   <appRoot>/resources/yt-dlp/yt-dlp.exe (Feature 9)
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
  /** yt-dlp, for mpv's ytdl hook (Feature 9 network streaming). Bundled under
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
}

export interface RequiredPackagedResource {
  label: string
  path: string
  kind: 'file' | 'directory'
}

/** Pure. Lists the runtime files and layout that must exist in an installer. */
export function requiredPackagedResources(resourcesPath: string): RequiredPackagedResource[] {
  const paths = resolveBinaryPaths({
    isPackaged: true,
    resourcesPath,
    appRoot: ''
  })
  return [
    { label: 'mpv', path: paths.mpvPath, kind: 'file' },
    { label: 'ffmpeg', path: paths.ffmpegPath, kind: 'file' },
    { label: 'ffprobe', path: paths.ffprobePath, kind: 'file' },
    { label: 'MeCab', path: paths.mecabPath, kind: 'file' },
    { label: 'MeCab IPADIC', path: paths.ipadicDir, kind: 'directory' }
  ]
}

/** Pure. Resolves the three Phase-1 binary paths for the given run mode. */
export function resolveBinaryPaths({
  isPackaged,
  resourcesPath,
  appRoot
}: ResolveBinaryPathsOptions): BinaryPaths {
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
