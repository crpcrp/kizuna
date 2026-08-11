import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import {
  missingResourceMessage,
  requiredGameOcrResources,
  requiredPackagedResources,
  resolveBinaryPaths,
  resolveGameOcrPaths,
  resolveThirdPartyNoticesPath,
  resolveUserUnidicDir
} from '@src/main/resourcePaths'
import { PATH_PLATFORMS } from '@test/harness/platformPaths'

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
      unidicDir: win32.join('C:\\Program Files\\Kizuna\\resources', 'mecab', 'unidic')
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
      mecabPath: posix.join('/opt/kizuna/resources', 'mecab', 'bin', 'mecab'),
      ipadicDir: posix.join('/opt/kizuna/resources', 'mecab', 'ipadic'),
      unidicDir: posix.join('/opt/kizuna/resources', 'mecab', 'unidic')
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
      unidicDir: '/usr/share/mecab/dic/unidic'
    })
  })
})

describe.each(PATH_PLATFORMS)(
  'resolveUserUnidicDir on $label',
  ({ platform, path, userDataDir }) => {
    it('keeps mutable UniDic below Electron userData', () => {
      expect(resolveUserUnidicDir(userDataDir, platform)).toBe(
        path.join(userDataDir, 'mecab', 'unidic')
      )
    })
  }
)

describe('requiredPackagedResources', () => {
  it('keeps every smoke-check path aligned with the platform lock', () => {
    const lock = JSON.parse(readFileSync('resources.lock.json', 'utf8')) as {
      platforms: Record<string, { requiredPaths: string[] }>
    }
    const windowsRoot = 'C:\\app\\resources'
    const linuxRoot = '/opt/kizuna/resources'

    expect(
      requiredPackagedResources(windowsRoot, 'win32').map((resource) =>
        win32.relative(windowsRoot, resource.path).replaceAll('\\', '/')
      )
    ).toEqual(lock.platforms['win32-x64'].requiredPaths)
    expect(
      requiredPackagedResources(linuxRoot, 'linux').map((resource) =>
        posix.relative(linuxRoot, resource.path)
      )
    ).toEqual(lock.platforms['linux-x64'].requiredPaths)
  })

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
        label: 'MeCab configuration',
        path: win32.join('C:\\app\\resources', 'mecab', 'mecabrc'),
        kind: 'file'
      },
      {
        label: 'MeCab IPADIC sys.dic',
        path: win32.join('C:\\app\\resources', 'mecab', 'ipadic', 'sys.dic'),
        kind: 'file'
      },
      {
        label: 'MeCab IPADIC matrix.bin',
        path: win32.join('C:\\app\\resources', 'mecab', 'ipadic', 'matrix.bin'),
        kind: 'file'
      },
      {
        label: 'MeCab IPADIC char.bin',
        path: win32.join('C:\\app\\resources', 'mecab', 'ipadic', 'char.bin'),
        kind: 'file'
      },
      {
        label: 'MeCab IPADIC unk.dic',
        path: win32.join('C:\\app\\resources', 'mecab', 'ipadic', 'unk.dic'),
        kind: 'file'
      }
    ])
  })

  it('enumerates the Linux wrapper, loader library, config, and dictionary', () => {
    expect(requiredPackagedResources('/opt/kizuna/resources', 'linux')).toEqual([
      { label: 'mpv', path: '/opt/kizuna/resources/mpv/mpv', kind: 'file' },
      { label: 'ffmpeg', path: '/opt/kizuna/resources/ffmpeg/ffmpeg', kind: 'file' },
      { label: 'ffprobe', path: '/opt/kizuna/resources/ffmpeg/ffprobe', kind: 'file' },
      { label: 'MeCab', path: '/opt/kizuna/resources/mecab/bin/mecab', kind: 'file' },
      {
        label: 'MeCab executable',
        path: '/opt/kizuna/resources/mecab/bin/mecab.bin',
        kind: 'file'
      },
      {
        label: 'MeCab shared library',
        path: '/opt/kizuna/resources/mecab/lib/libmecab.so.2',
        kind: 'file'
      },
      {
        label: 'MeCab shared library payload',
        path: '/opt/kizuna/resources/mecab/lib/libmecab.so.2.0.0',
        kind: 'file'
      },
      {
        label: 'MeCab configuration',
        path: '/opt/kizuna/resources/mecab/etc/mecabrc',
        kind: 'file'
      },
      {
        label: 'MeCab IPADIC char.bin',
        path: '/opt/kizuna/resources/mecab/ipadic/char.bin',
        kind: 'file'
      },
      {
        label: 'MeCab IPADIC dicrc',
        path: '/opt/kizuna/resources/mecab/ipadic/dicrc',
        kind: 'file'
      },
      {
        label: 'MeCab IPADIC matrix.bin',
        path: '/opt/kizuna/resources/mecab/ipadic/matrix.bin',
        kind: 'file'
      },
      {
        label: 'MeCab IPADIC sys.dic',
        path: '/opt/kizuna/resources/mecab/ipadic/sys.dic',
        kind: 'file'
      },
      {
        label: 'MeCab IPADIC unk.dic',
        path: '/opt/kizuna/resources/mecab/ipadic/unk.dic',
        kind: 'file'
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
})

describe.each(PATH_PLATFORMS)('resolveThirdPartyNoticesPath on $label', ({ platform, path }) => {
  it('uses the generated development bundle', () => {
    const appRoot = platform === 'win32' ? 'E:\\src\\kizuna' : '/home/me/kizuna'
    expect(
      resolveThirdPartyNoticesPath({
        isPackaged: false,
        resourcesPath: 'ignored',
        appRoot,
        platform
      })
    ).toBe(path.join(appRoot, 'build', 'notices', 'THIRD_PARTY_NOTICES.md'))
  })

  it('uses the packaged resources bundle', () => {
    const resourcesPath = platform === 'win32' ? 'C:\\Kizuna\\resources' : '/opt/kizuna/resources'
    expect(
      resolveThirdPartyNoticesPath({
        isPackaged: true,
        resourcesPath,
        appRoot: 'ignored',
        platform
      })
    ).toBe(path.join(resourcesPath, 'notices', 'THIRD_PARTY_NOTICES.md'))
  })
})

describe('resolveGameOcrPaths', () => {
  it('resolves the packaged Windows payload beside the other resources', () => {
    const resourcesPath = 'C:\\Program Files\\Kizuna\\resources'
    expect(
      resolveGameOcrPaths({
        isPackaged: true,
        resourcesPath,
        appRoot: 'E:\\ignored',
        platform: 'win32'
      })
    ).toEqual({
      workerPath: win32.join(resourcesPath, 'paddleocr', 'paddleocr.exe'),
      detectionModelDir: win32.join(resourcesPath, 'paddleocr', 'models', 'det'),
      recognitionModelDir: win32.join(resourcesPath, 'paddleocr', 'models', 'rec')
    })
  })

  it('resolves the development payload under the project resources folder', () => {
    expect(
      resolveGameOcrPaths({
        isPackaged: false,
        resourcesPath: 'C:\\ignored',
        appRoot: 'E:\\src\\kizuna',
        platform: 'win32'
      }).workerPath
    ).toBe(win32.join('E:\\src\\kizuna', 'resources', 'paddleocr', 'paddleocr.exe'))
  })

  // The Linux artifacts deliberately omit the payload (see
  // `win.extraResources` in electron-builder.cjs), so there is no Linux path
  // to hand out and a caller asking for one is the bug worth reporting.
  it('refuses to resolve a Linux path', () => {
    expect(() =>
      resolveGameOcrPaths({
        isPackaged: true,
        resourcesPath: '/opt/kizuna/resources',
        appRoot: '/ignored',
        platform: 'linux'
      })
    ).toThrow('Game OCR resources ship on Windows only, not linux')
  })
})

describe('Game OCR resource validation', () => {
  const paths = resolveGameOcrPaths({
    isPackaged: true,
    resourcesPath: 'C:\\Kizuna\\resources',
    appRoot: 'ignored',
    platform: 'win32'
  })
  const required = requiredGameOcrResources(paths)

  it('requires the worker executable and both model directories', () => {
    expect(required).toEqual([
      { label: 'PaddleOCR worker', path: paths.workerPath, kind: 'file' },
      { label: 'PaddleOCR detection model', path: paths.detectionModelDir, kind: 'directory' },
      { label: 'PaddleOCR recognition model', path: paths.recognitionModelDir, kind: 'directory' }
    ])
  })

  it('passes when every resource has the expected kind', () => {
    expect(
      missingResourceMessage(required, (path) => (path === paths.workerPath ? 'file' : 'directory'))
    ).toBeUndefined()
  })

  it('names the missing resource and its path', () => {
    const message = missingResourceMessage(required, (path) =>
      path === paths.recognitionModelDir
        ? 'missing'
        : path === paths.workerPath
          ? 'file'
          : 'directory'
    )

    expect(message).toContain('PaddleOCR recognition model is missing')
    expect(message).toContain(paths.recognitionModelDir)
  })

  // A truncated download can leave a model directory replaced by a stray file,
  // which spawns a worker that fails with an opaque Paddle error instead.
  it('reports a resource of the wrong kind', () => {
    expect(missingResourceMessage(required, () => 'file')).toContain(
      'PaddleOCR detection model is not a directory'
    )
  })
})
