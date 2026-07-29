// Phase 3 · G2 — secrets boundary. Keeps Electron's `safeStorage` out of the
// services; a `SecretCodec` is injected exactly like `FfmpegExec`/`MecabExec`.

export interface SecretCodec {
  encrypt(plain: string): string
  decrypt(blob: string): string
  /**
   * `true` only when `encrypt`/`decrypt` actually protect the secret at rest.
   * The identity fallback returns `false`, letting the UI tell the user their
   * token is stored unencrypted rather than claiming it is "encrypted at rest".
   */
  isAvailable(): boolean
}

/** Pure passthrough — used when the OS can't provide encryption. */
export const identityCodec: SecretCodec = {
  encrypt: (plain) => plain,
  decrypt: (blob) => blob,
  isAvailable: () => false
}

/**
 * Wraps Electron's `safeStorage` as a base64-string `SecretCodec`. Falls back
 * to `identityCodec` when encryption is unavailable (e.g. no OS keychain).
 * `decrypt` never throws: a token encrypted under a different Windows
 * account (or after a machine restore) yields garbage bytes rather than a
 * valid string, so a failed decrypt returns `''` and lets the UI show "not
 * configured" instead of crashing.
 */
export function createSafeStorageCodec(safeStorage: {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}): SecretCodec {
  if (!safeStorage.isEncryptionAvailable()) return identityCodec

  return {
    encrypt(plain: string): string {
      return safeStorage.encryptString(plain).toString('base64')
    },
    decrypt(blob: string): string {
      try {
        return safeStorage.decryptString(Buffer.from(blob, 'base64'))
      } catch {
        return ''
      }
    },
    // Only reached when `isEncryptionAvailable()` was true above.
    isAvailable: () => true
  }
}

/** `''`/`undefined` blob (not configured) decodes to `''` without invoking the codec. */
export function readSecret(codec: SecretCodec, blob: string | undefined): string {
  if (!blob) return ''
  return codec.decrypt(blob)
}
