import { describe, expect, it, vi } from 'vitest'
import {
  createUserUnidicManager,
  migrateLegacyUnidic,
  type UnidicMigrationFsLike
} from '@src/main/services/mecab/unidic'
import { isValidMecabDictionaryDir } from '@src/main/services/mecab/dictionaryValidation'

const LEGACY = '/opt/Kizuna/resources/mecab/unidic'
const TARGET = '/home/me/.config/Kizuna/mecab/unidic'
const STAGING = `${TARGET}.staging`

interface FakeMigrationFs {
  fs: UnidicMigrationFsLike
  existing: Set<string>
  cpSync: ReturnType<typeof vi.fn>
  renameSync: ReturnType<typeof vi.fn>
}

function fakeMigrationFs(initial: string[] = []): FakeMigrationFs {
  const existing = new Set(initial)
  const cpSync = vi.fn((_source: string, destination: string) => {
    existing.add(destination)
  })
  const renameSync = vi.fn((source: string, destination: string) => {
    existing.delete(source)
    existing.add(destination)
  })
  const fs: UnidicMigrationFsLike = {
    existsSync: (path) => existing.has(path),
    mkdirSync: (path) => {
      existing.add(path)
    },
    cpSync,
    renameSync,
    rmSync: (path) => {
      existing.delete(path)
    }
  }
  return { fs, existing, cpSync, renameSync }
}

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

describe('migrateLegacyUnidic', () => {
  it('copies once through a staging directory and is idempotent', () => {
    const fake = fakeMigrationFs([LEGACY])

    expect(
      migrateLegacyUnidic({
        legacyDir: LEGACY,
        targetDir: TARGET,
        stagingDir: STAGING,
        fs: fake.fs,
        platform: 'linux'
      })
    ).toEqual({ status: 'migrated', source: LEGACY, target: TARGET })
    expect(fake.cpSync).toHaveBeenCalledWith(LEGACY, STAGING, {
      recursive: true,
      errorOnExist: true,
      force: false
    })
    expect(fake.renameSync).toHaveBeenCalledWith(STAGING, TARGET)

    const second = migrateLegacyUnidic({
      legacyDir: LEGACY,
      targetDir: TARGET,
      stagingDir: STAGING,
      fs: fake.fs,
      platform: 'linux'
    })
    expect(second).toEqual({ status: 'skipped', reason: 'target-exists' })
    expect(fake.cpSync).toHaveBeenCalledTimes(1)
  })

  it('never overwrites an existing persistent dictionary', () => {
    const fake = fakeMigrationFs([LEGACY, TARGET])

    expect(migrateLegacyUnidic({ legacyDir: LEGACY, targetDir: TARGET, fs: fake.fs })).toEqual({
      status: 'skipped',
      reason: 'target-exists'
    })
    expect(fake.cpSync).not.toHaveBeenCalled()
  })

  it('does nothing when the legacy source is absent', () => {
    const fake = fakeMigrationFs()

    expect(migrateLegacyUnidic({ legacyDir: LEGACY, targetDir: TARGET, fs: fake.fs })).toEqual({
      status: 'skipped',
      reason: 'legacy-missing'
    })
    expect(fake.cpSync).not.toHaveBeenCalled()
  })

  it('cleans a partial copy and leaves no target when copying fails', () => {
    const fake = fakeMigrationFs([LEGACY])
    fake.cpSync.mockImplementation(() => {
      fake.existing.add(STAGING)
      throw new Error('disk full')
    })

    const result = migrateLegacyUnidic({
      legacyDir: LEGACY,
      targetDir: TARGET,
      stagingDir: STAGING,
      fs: fake.fs,
      platform: 'linux'
    })

    expect(result).toEqual({
      status: 'failed',
      source: LEGACY,
      target: TARGET,
      error: 'disk full'
    })
    expect(fake.existing.has(STAGING)).toBe(false)
    expect(fake.existing.has(TARGET)).toBe(false)
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
