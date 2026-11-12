import { describe, expect, it, vi } from 'vitest'
import { createUserUnidicManager } from '@src/main/services/mecab/unidic'
import { isValidMecabDictionaryDir } from '@src/main/services/mecab/dictionaryValidation'

describe('createUserUnidicManager', () => {
  it('creates the persistent folder on demand and reveals it', async () => {
    const mkdirSync = vi.fn()
    const openPath = vi.fn(async () => '')
    const manager = createUserUnidicManager({
      userDataDir: 'C:\\Users\\me\\AppData\\Roaming\\Kizuna',
      fs: { mkdirSync },
      shell: { openPath },
      platform: 'win32'
    })

    expect(manager.dir).toBe('C:\\Users\\me\\AppData\\Roaming\\Kizuna\\mecab\\unidic')
    await expect(manager.open()).resolves.toBe('')
    expect(mkdirSync).toHaveBeenCalledWith(manager.dir, { recursive: true })
    expect(openPath).toHaveBeenCalledWith(manager.dir)
  })
})

describe('isValidMecabDictionaryDir', () => {
  it('requires a directory and all compiled dictionary files', () => {
    const files = new Set([
      '/dicts/unidic',
      '/dicts/unidic/char.bin',
      '/dicts/unidic/dicrc',
      '/dicts/unidic/matrix.bin',
      '/dicts/unidic/sys.dic',
      '/dicts/unidic/unk.dic'
    ])
    const fs = {
      statSync: (path: string) => ({
        isDirectory: () => path === '/dicts/unidic',
        isFile: () => files.has(path) && path !== '/dicts/unidic'
      })
    }

    expect(isValidMecabDictionaryDir('/dicts/unidic', fs, 'linux')).toBe(true)
    expect(isValidMecabDictionaryDir('/dicts/missing', fs, 'linux')).toBe(false)
    expect(isValidMecabDictionaryDir('/dicts/unidic/char.bin', fs, 'linux')).toBe(false)
  })
})
