import disk from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const tempDirs: string[] = []
function tempDir(): string {
  const dir = disk.mkdtempSync(join(tmpdir(), 'kizuna-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const dir of tempDirs.splice(0)) disk.rmSync(dir, { recursive: true, force: true })
})
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUserUnidicManager } from '@src/main/services/mecab/unidic'
import { isValidMecabDictionaryDir } from '@src/main/services/mecab/dictionaryValidation'

describe('UniDic folders', () => {
  it('creates the persistent folder on demand and reveals it', async () => {
    const openPath = vi.fn(async () => '')
    const manager = createUserUnidicManager({ userDataDir: tempDir(), shell: { openPath } })
    expect(disk.existsSync(manager.dir)).toBe(false)
    await expect(manager.open()).resolves.toBe('')
    expect(disk.statSync(manager.dir).isDirectory()).toBe(true)
    expect(openPath).toHaveBeenCalledWith(manager.dir)
  })

  it('requires a directory and all compiled dictionary files', () => {
    const dir = tempDir()
    expect(isValidMecabDictionaryDir(dir)).toBe(false)
    for (const name of ['char.bin', 'dicrc', 'matrix.bin', 'sys.dic', 'unk.dic'])
      disk.writeFileSync(join(dir, name), '')
    expect(isValidMecabDictionaryDir(dir)).toBe(true)
    expect(isValidMecabDictionaryDir(join(dir, 'missing'))).toBe(false)
    expect(isValidMecabDictionaryDir(join(dir, 'char.bin'))).toBe(false)
    disk.unlinkSync(join(dir, 'sys.dic'))
    disk.mkdirSync(join(dir, 'sys.dic'))
    expect(isValidMecabDictionaryDir(dir)).toBe(false)
  })
})
