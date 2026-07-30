// A reversing "encryption": encrypt reverses the string, decrypt reverses it
// back. Cheap to assert round-trips without touching Electron's safeStorage.

import type { SecretCodec } from '../../src/main/services/secrets'

export const reversingCodec: SecretCodec = {
  encrypt: (plain) => [...plain].reverse().join(''),
  decrypt: (blob) => [...blob].reverse().join(''),
  isAvailable: () => true
}

/** Fake `safeStorage`-shaped object for exercising `createSafeStorageCodec`. */
export function fakeSafeStorage(opts: { available: boolean }): {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
} {
  return {
    isEncryptionAvailable: () => opts.available,
    encryptString: (s: string) => Buffer.from([...s].reverse().join(''), 'utf-8'),
    decryptString: (b: Buffer) => [...b.toString('utf-8')].reverse().join('')
  }
}
