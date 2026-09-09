import type {
  JimakuError,
  JimakuErrorCode,
  JimakuSearchRequest,
  JimakuSettingsStatus,
  JimakuTestOutcome
} from '../../../shared/jimaku'
import { readSecret, type SecretCodec } from '../secrets'
import { defaultJimakuSettings, type SettingsStore } from '../settings'
import type { JimakuClient } from './client'

export const JIMAKU_MAX_API_KEY_LENGTH = 4096
/** A harmless, fixed read-only query used only to verify authentication. */
export const JIMAKU_CONNECTION_TEST_QUERY = 'Kizuna'

const INVALID_API_KEY = 'Invalid Jimaku API key.'
const SAVE_FAILURE = 'Could not save Jimaku settings.'
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u

export interface JimakuSettingsService {
  getStatus(): JimakuSettingsStatus
  setApiKey(value: string): JimakuSettingsStatus
  clearApiKey(): JimakuSettingsStatus
  testConnection(): Promise<JimakuSettingsStatus>

  /** Main-process-only accessors used by the later search service. */
  getApiKey(): string
  getConfigGeneration(): number
  onConfigChange(listener: (generation: number) => void): () => void
}

export interface CreateJimakuSettingsServiceDeps {
  settings: SettingsStore
  secrets: SecretCodec
  client: Pick<JimakuClient, 'searchEntries'>
}

/** Owns Jimaku's encrypted credential and the explicit connection test. */
export function createJimakuSettingsService(
  deps: CreateJimakuSettingsServiceDeps
): JimakuSettingsService {
  let configGeneration = 0
  let testOutcome: JimakuTestOutcome = { status: 'notTested' }
  const listeners = new Set<(generation: number) => void>()
  const activeTests = new Set<AbortController>()

  function storedSettings() {
    try {
      return deps.settings.get().jimaku
    } catch {
      return defaultJimakuSettings
    }
  }

  function storedValue(): string {
    const value = storedSettings().apiKeyEnc
    return typeof value === 'string' ? value : ''
  }

  function readApiKey(): string {
    const encoded = storedValue()
    if (encoded === '') return ''

    try {
      const value = readSecret(deps.secrets, encoded)
      const normalized = normalizeApiKey(value)
      return normalized
    } catch {
      return ''
    }
  }

  function publicStatus(): JimakuSettingsStatus {
    let secretStorageAvailable = false
    try {
      secretStorageAvailable = deps.secrets.isAvailable()
    } catch {
      // An unavailable/throwing codec must never make setup crash.
    }
    return {
      configured: readApiKey() !== '',
      secretStorageAvailable,
      testOutcome
    }
  }

  function invalidateConfiguration(): void {
    configGeneration++
    testOutcome = { status: 'notTested' }
    for (const controller of activeTests) controller.abort()
    for (const listener of listeners) {
      try {
        listener(configGeneration)
      } catch {
        // A future consumer must not be able to break credential persistence.
      }
    }
  }

  function saveApiKey(apiKey: string): JimakuSettingsStatus {
    const currentApiKey = readApiKey()
    const currentEncoded = storedValue()
    if (apiKey === currentApiKey && (apiKey !== '' || currentEncoded === '')) {
      return publicStatus()
    }

    let encoded = ''
    try {
      encoded = apiKey === '' ? '' : deps.secrets.encrypt(apiKey)
      if (apiKey !== '' && (typeof encoded !== 'string' || encoded === '')) throw new Error()
      const current = deps.settings.get().jimaku
      deps.settings.set({ jimaku: { ...current, apiKeyEnc: encoded } })
    } catch {
      throw new Error(SAVE_FAILURE)
    }

    invalidateConfiguration()
    return publicStatus()
  }

  async function testConnection(): Promise<JimakuSettingsStatus> {
    const apiKey = readApiKey()
    const generation = configGeneration
    if (apiKey === '') {
      testOutcome = { status: 'error', error: { code: 'notConfigured' } }
      return publicStatus()
    }

    const controller = new AbortController()
    activeTests.add(controller)
    const request: JimakuSearchRequest = {
      query: JIMAKU_CONNECTION_TEST_QUERY,
      anime: true
    }

    try {
      let result: Awaited<ReturnType<JimakuClient['searchEntries']>> | undefined
      try {
        result = await deps.client.searchEntries(request, controller.signal)
      } catch {
        result = undefined
      }

      // A replacement/clear wins over every completion from the old key. The
      // current status is deliberately returned, with no stale outcome.
      if (generation !== configGeneration || apiKey !== readApiKey()) return publicStatus()

      testOutcome =
        result?.ok === true
          ? { status: 'connected' }
          : {
              status: 'error',
              error: sanitizeError(result !== undefined && !result.ok ? result.error : undefined)
            }
      return publicStatus()
    } finally {
      activeTests.delete(controller)
    }
  }

  return {
    getStatus: publicStatus,
    setApiKey(value: string): JimakuSettingsStatus {
      return saveApiKey(normalizeApiKey(value))
    },
    clearApiKey(): JimakuSettingsStatus {
      return saveApiKey('')
    },
    testConnection,
    getApiKey: readApiKey,
    getConfigGeneration: () => configGeneration,
    onConfigChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

export function normalizeApiKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error(INVALID_API_KEY)
  const normalized = value.trim()
  if ([...normalized].length > JIMAKU_MAX_API_KEY_LENGTH || CONTROL_CHARACTER.test(normalized)) {
    throw new Error(INVALID_API_KEY)
  }
  return normalized
}

function sanitizeError(value: unknown): JimakuError {
  const object = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const code = isJimakuErrorCode(object.code) ? object.code : 'network'
  if (code === 'rateLimited' && typeof object.retryAt === 'string') {
    const retryAt = object.retryAt
    if (Number.isFinite(Date.parse(retryAt))) return { code, retryAt }
  }
  return { code }
}

function isJimakuErrorCode(value: unknown): value is JimakuErrorCode {
  switch (value) {
    case 'cancelled':
    case 'timeout':
    case 'network':
    case 'unauthorized':
    case 'notFound':
    case 'rateLimited':
    case 'serviceUnavailable':
    case 'invalidResponse':
    case 'notConfigured':
    case 'invalidRequest':
      return true
    default:
      return false
  }
}
