import { describe, expect, it } from 'vitest'
import { posix, win32 } from 'node:path'
import { requiredPackagedResources, resolveBinaryPaths } from '@src/main/resourcePaths'

describe('resolveBinaryPaths', () => {
  it('uses Windows resource paths for packaged and development targets', () => {
    expect(
      resolveBinaryPaths({
        isPackaged: true,
        resourcesPath: 'C:\\Program Files\\Kizuna\\resources',
        appRoot: 'E:\\ignored',
        platform: 'win32'
      })
    ).toEqual({
      mpvPath: win32.join('C:\\Program Files\\Kizuna\\resources', 'mpv', 'mpv.exe'),
      ffprobePath: win32.join('C:\\Program Files\\Kizuna\\resources', 'ffmpeg', 'ffprobe.exe'),
      ffmpegPath: win32.join('C:\\Program Files\\Kizuna\\resources', 'ffmpeg', 'ffmpeg.exe'),
      mecabPath: win32.join('C:\\Program Files\\Kizuna\\resources', 'mecab', 'mecab.exe'),
      ipadicDir: win32.join('C:\\Program Files\\Kizuna\\resources', 'mecab', 'ipadic'),
      unidicDir: win32.join('C:\\Program Files\\Kizuna\\resources', 'mecab', 'unidic'),
      ytdlpPath: win32.join('C:\\Program Files\\Kizuna\\resources', 'yt-dlp', 'yt-dlp.exe')
    })
  })

  it('resolves a packaged Linux target with POSIX paths even on a Windows host', () => {
    expect(
      resolveBinaryPaths({
        isPackaged: true,
        resourcesPath: '/opt/kizuna/resources',
        appRoot: 'C:\\ignored',
        platform: 'linux'
      })
    ).toEqual({
      mpvPath: posix.join('/opt/kizuna/resources', 'mpv', 'mpv'),
      ffprobePath: posix.join('/opt/kizuna/resources', 'ffmpeg', 'ffprobe'),
      ffmpegPath: posix.join('/opt/kizuna/resources', 'ffmpeg', 'ffmpeg'),
      mecabPath: posix.join('/opt/kizuna/resources', 'mecab', 'mecab'),
      ipadicDir: posix.join('/opt/kizuna/resources', 'mecab', 'ipadic'),
      unidicDir: posix.join('/opt/kizuna/resources', 'mecab', 'unidic'),
      ytdlpPath: posix.join('/opt/kizuna/resources', 'yt-dlp', 'yt-dlp')
    })
  })

  it('keeps unpackaged Linux development on distro tools', () => {
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
  it('enumerates Windows runtime files and dictionary paths', () => {
    expect(requiredPackagedResources('C:\\app\\resources', 'win32')).toEqual([
      { label: 'mpv', path: win32.join('C:\\app\\resources', 'mpv', 'mpv.exe'), kind: 'file' },
      {
        label: 'ffmpeg',
        path: win32.join('C:\\app\\resources', 'ffmpeg', 'ffmpeg.exe'),
        kind: 'file'
      },
      {
        label: 'ffprobe',
        path: win32.join('C:\\app\\resources', 'ffmpeg', 'ffprobe.exe'),
        kind: 'file'
      },
      {
        label: 'MeCab',
        path: win32.join('C:\\app\\resources', 'mecab', 'mecab.exe'),
        kind: 'file'
      },
      {
        label: 'MeCab shared library',
        path: win32.join('C:\\app\\resources', 'mecab', 'libmecab.dll'),
        kind: 'file'
      },
      {
        label: 'MeCab IPADIC',
        path: win32.join('C:\\app\\resources', 'mecab', 'ipadic'),
        kind: 'directory'
      }
    ])
  })

  it('enumerates the Linux wrapper, loader library, config, and dictionary', () => {
    expect(requiredPackagedResources('/opt/kizuna/resources', 'linux')).toEqual([
      { label: 'mpv', path: '/opt/kizuna/resources/mpv/mpv', kind: 'file' },
      { label: 'ffmpeg', path: '/opt/kizuna/resources/ffmpeg/ffmpeg', kind: 'file' },
      { label: 'ffprobe', path: '/opt/kizuna/resources/ffmpeg/ffprobe', kind: 'file' },
      { label: 'MeCab', path: '/opt/kizuna/resources/mecab/mecab', kind: 'file' },
      {
        label: 'MeCab executable',
        path: '/opt/kizuna/resources/mecab/mecab.bin',
        kind: 'file'
      },
      {
        label: 'MeCab shared library',
        path: '/opt/kizuna/resources/mecab/lib/libmecab.so.2',
        kind: 'file'
      },
      {
        label: 'MeCab configuration',
        path: '/opt/kizuna/resources/mecab/mecabrc',
        kind: 'file'
      },
      {
        label: 'MeCab IPADIC',
        path: '/opt/kizuna/resources/mecab/ipadic',
        kind: 'directory'
      }
    ])
  })

  it('rejects unsupported targets clearly', () => {
    expect(() =>
      resolveBinaryPaths({
        isPackaged: true,
        resourcesPath: '/resources',
        appRoot: '/app',
        platform: 'darwin'
      })
    ).toThrow('Unsupported platform for resource paths: darwin')
  })
})
