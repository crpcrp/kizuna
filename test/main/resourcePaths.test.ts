import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { requiredPackagedResources, resolveBinaryPaths } from '@src/main/resourcePaths'

describe('resolveBinaryPaths', () => {
  it('resolves under resourcesPath when packaged', () => {
    const result = resolveBinaryPaths({
      isPackaged: true,
      resourcesPath: 'C:\\Program Files\\Kizuna\\resources',
      appRoot: 'E:\\ignored',
      platform: 'win32'
    })
    expect(result).toEqual({
      mpvPath: join('C:\\Program Files\\Kizuna\\resources', 'mpv', 'mpv.exe'),
      ffprobePath: join('C:\\Program Files\\Kizuna\\resources', 'ffmpeg', 'ffprobe.exe'),
      ffmpegPath: join('C:\\Program Files\\Kizuna\\resources', 'ffmpeg', 'ffmpeg.exe'),
      mecabPath: join('C:\\Program Files\\Kizuna\\resources', 'mecab', 'mecab.exe'),
      ipadicDir: join('C:\\Program Files\\Kizuna\\resources', 'mecab', 'ipadic'),
      unidicDir: join('C:\\Program Files\\Kizuna\\resources', 'mecab', 'unidic'),
      ytdlpPath: join('C:\\Program Files\\Kizuna\\resources', 'yt-dlp', 'yt-dlp.exe')
    })
  })

  it('resolves under <appRoot>/resources when not packaged', () => {
    const result = resolveBinaryPaths({
      isPackaged: false,
      resourcesPath: 'C:\\ignored',
      appRoot: 'E:\\repos\\kizuna',
      platform: 'win32'
    })
    expect(result).toEqual({
      mpvPath: join('E:\\repos\\kizuna', 'resources', 'mpv', 'mpv.exe'),
      ffprobePath: join('E:\\repos\\kizuna', 'resources', 'ffmpeg', 'ffprobe.exe'),
      ffmpegPath: join('E:\\repos\\kizuna', 'resources', 'ffmpeg', 'ffmpeg.exe'),
      mecabPath: join('E:\\repos\\kizuna', 'resources', 'mecab', 'mecab.exe'),
      ipadicDir: join('E:\\repos\\kizuna', 'resources', 'mecab', 'ipadic'),
      unidicDir: join('E:\\repos\\kizuna', 'resources', 'mecab', 'unidic'),
      ytdlpPath: join('E:\\repos\\kizuna', 'resources', 'yt-dlp', 'yt-dlp.exe')
    })
  })

  it('bundles yt-dlp under the yt-dlp folder to match electron-builder extraResources', () => {
    const packaged = resolveBinaryPaths({
      isPackaged: true,
      resourcesPath: '/r',
      appRoot: '/a',
      platform: 'win32'
    })
    expect(packaged.ytdlpPath).toBe(join('/r', 'yt-dlp', 'yt-dlp.exe'))
  })

  it('resolves extensionless executables on Linux in the existing layout', () => {
    const result = resolveBinaryPaths({
      isPackaged: true,
      resourcesPath: '/opt/kizuna/resources',
      appRoot: '/ignored',
      platform: 'linux'
    })

    expect(result).toEqual({
      mpvPath: join('/opt/kizuna/resources', 'mpv', 'mpv'),
      ffprobePath: join('/opt/kizuna/resources', 'ffmpeg', 'ffprobe'),
      ffmpegPath: join('/opt/kizuna/resources', 'ffmpeg', 'ffmpeg'),
      mecabPath: join('/opt/kizuna/resources', 'mecab', 'mecab'),
      ipadicDir: join('/opt/kizuna/resources', 'mecab', 'ipadic'),
      unidicDir: join('/opt/kizuna/resources', 'mecab', 'unidic'),
      ytdlpPath: join('/opt/kizuna/resources', 'yt-dlp', 'yt-dlp')
    })
  })
})

describe('requiredPackagedResources', () => {
  it('lists the required executables and MeCab dictionary layout', () => {
    expect(requiredPackagedResources('C:\\app\\resources', 'win32')).toEqual([
      {
        label: 'mpv',
        path: join('C:\\app\\resources', 'mpv', 'mpv.exe'),
        kind: 'file'
      },
      {
        label: 'ffmpeg',
        path: join('C:\\app\\resources', 'ffmpeg', 'ffmpeg.exe'),
        kind: 'file'
      },
      {
        label: 'ffprobe',
        path: join('C:\\app\\resources', 'ffmpeg', 'ffprobe.exe'),
        kind: 'file'
      },
      {
        label: 'MeCab',
        path: join('C:\\app\\resources', 'mecab', 'mecab.exe'),
        kind: 'file'
      },
      {
        label: 'MeCab IPADIC',
        path: join('C:\\app\\resources', 'mecab', 'ipadic'),
        kind: 'directory'
      }
    ])
  })

  it('lists extensionless Linux executables and the same dictionary layout', () => {
    expect(requiredPackagedResources('/opt/kizuna/resources', 'linux')).toEqual([
      {
        label: 'mpv',
        path: join('/opt/kizuna/resources', 'mpv', 'mpv'),
        kind: 'file'
      },
      {
        label: 'ffmpeg',
        path: join('/opt/kizuna/resources', 'ffmpeg', 'ffmpeg'),
        kind: 'file'
      },
      {
        label: 'ffprobe',
        path: join('/opt/kizuna/resources', 'ffmpeg', 'ffprobe'),
        kind: 'file'
      },
      {
        label: 'MeCab',
        path: join('/opt/kizuna/resources', 'mecab', 'mecab'),
        kind: 'file'
      },
      {
        label: 'MeCab IPADIC',
        path: join('/opt/kizuna/resources', 'mecab', 'ipadic'),
        kind: 'directory'
      }
    ])
  })

  it('rejects unsupported platforms clearly', () => {
    expect(() =>
      resolveBinaryPaths({
        isPackaged: true,
        resourcesPath: '/resources',
        appRoot: '/app',
        platform: 'darwin'
      })
    ).toThrow('Unsupported platform for resource paths: darwin')

    expect(() => requiredPackagedResources('/resources', 'darwin')).toThrow(
      'Unsupported platform for resource paths: darwin'
    )
  })
})
