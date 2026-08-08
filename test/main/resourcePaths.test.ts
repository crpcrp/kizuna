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

  it('uses distribution tools for an unpackaged Linux checkout', () => {
    expect(
      resolveBinaryPaths({
        isPackaged: false,
        resourcesPath: '/ignored',
        appRoot: '/home/user/kizuna',
        platform: 'linux'
      })
    ).toEqual({
      mpvPath: '/usr/bin/mpv',
      ffprobePath: '/usr/bin/ffprobe',
      ffmpegPath: '/usr/bin/ffmpeg',
      mecabPath: '/usr/bin/mecab',
      ipadicDir: '/var/lib/mecab/dic/debian',
      unidicDir: '/usr/share/mecab/dic/unidic',
      ytdlpPath: '/usr/bin/yt-dlp'
    })
  })
})

describe('requiredPackagedResources', () => {
  it('lists the required executables and MeCab dictionary layout', () => {
    expect(requiredPackagedResources('C:\\app\\resources')).toEqual([
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

  it('rejects unsupported platforms clearly', () => {
    expect(() =>
      resolveBinaryPaths({
        isPackaged: true,
        resourcesPath: '/resources',
        appRoot: '/app',
        platform: 'darwin'
      })
    ).toThrow('Unsupported platform for resource paths: darwin')
  })

  it('rejects packaged Linux until a Linux distribution target exists', () => {
    expect(() =>
      resolveBinaryPaths({
        isPackaged: true,
        resourcesPath: '/resources',
        appRoot: '/app',
        platform: 'linux'
      })
    ).toThrow('Packaged Linux builds are not supported')
  })
})
