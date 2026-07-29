import { describe, it, expect } from 'vitest'
import { identityCodec, createSafeStorageCodec, readSecret } from '@src/main/services/secrets'
import { fakeSafeStorage } from '@test/harness/fakeSecrets'

describe('identityCodec', () => {
  it('passes strings through unchanged', () => {
    expect(identityCodec.encrypt('hunter2')).toBe('hunter2')
    expect(identityCodec.decrypt('hunter2')).toBe('hunter2')
  })

  it('reports isAvailable() === false — the plaintext fallback is not real encryption', () => {
    expect(identityCodec.isAvailable()).toBe(false)
  })
})

describe('createSafeStorageCodec', () => {
  it('round-trips a string when encryption is available', () => {
    const codec = createSafeStorageCodec(fakeSafeStorage({ available: true }))
    const blob = codec.encrypt('my-wanikani-token')
    expect(codec.decrypt(blob)).toBe('my-wanikani-token')
  })

  it('reports isAvailable() === true when encryption is available', () => {
    const codec = createSafeStorageCodec(fakeSafeStorage({ available: true }))
    expect(codec.isAvailable()).toBe(true)
  })

  it('falls back to identityCodec (isAvailable() === false) when encryption is unavailable', () => {
    const codec = createSafeStorageCodec(fakeSafeStorage({ available: false }))
    expect(codec).toBe(identityCodec)
    expect(codec.isAvailable()).toBe(false)
  })

  it('decrypt never throws — returns "" on a corrupt/undecodable blob', () => {
    const codec = createSafeStorageCodec({
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.from('irrelevant'),
      decryptString: () => {
        throw new Error('bad decrypt (wrong account / restored machine)')
      }
    })
    expect(codec.decrypt('not-a-real-blob')).toBe('')
  })
})

describe('readSecret', () => {
  it('returns "" for an undefined blob without invoking the codec', () => {
    const codec = createSafeStorageCodec(fakeSafeStorage({ available: true }))
    expect(readSecret(codec, undefined)).toBe('')
  })

  it('returns "" for an empty-string blob', () => {
    const codec = createSafeStorageCodec(fakeSafeStorage({ available: true }))
    expect(readSecret(codec, '')).toBe('')
  })

  it('decrypts a configured blob', () => {
    const codec = createSafeStorageCodec(fakeSafeStorage({ available: true }))
    const blob = codec.encrypt('secret-token')
    expect(readSecret(codec, blob)).toBe('secret-token')
  })

  it('delegates a corrupt blob to the codec and surfaces "" rather than throwing', () => {
    const throwingCodec = createSafeStorageCodec({
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.from('irrelevant'),
      decryptString: () => {
        throw new Error('bad decrypt')
      }
    })
    expect(readSecret(throwingCodec, 'corrupt-blob')).toBe('')
  })
})
