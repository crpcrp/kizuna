import type { McDict } from '../../../shared/mecab'
import type { DictInfo } from '../../../shared/dictionary'
import type { AnkiPing, AnkiSettings } from '../../../shared/anki'
import type { BundledBinaryStatus } from '../../../shared/integrationStatus'
import type { PublicKnowledgeSettings, SyncStatus } from '../../../shared/knowledge'

export type LoadState = 'idle' | 'loading' | 'ready' | 'error'

export type OptionsDomain = 'dictionaries' | 'anki' | 'knowledge' | 'setup'

export interface DomainState<T> {
  status: LoadState
  data: T | undefined
  error: string | undefined
}

export interface DictionariesData {
  mecabDicts: McDict[]
  currentMecabDictId: 'ipadic' | 'unidic'
  yomitanDicts: DictInfo[]
}

export interface AnkiData {
  settings: AnkiSettings
  deckNames: string[]
  modelNames: string[]
  modelFields: string[]
}

export interface KnowledgeData {
  settings: PublicKnowledgeSettings
  syncStatus: SyncStatus
}

/** The two live signals the read-only "Setup & integrations" tab needs and no
 * other tab already carries: which bundled binaries exist, and whether Anki is
 * answering right now. Everything else on that tab is derived from the
 * dictionaries/knowledge domains. */
export interface SetupData {
  binaries: BundledBinaryStatus
  anki: AnkiPing
}

export interface OptionsDomainData {
  dictionaries: DictionariesData
  anki: AnkiData
  knowledge: KnowledgeData
  setup: SetupData
}

/** Subset of the preload bridge the options-data controller needs. */
export interface OptionsDataBridge {
  mecab: {
    listDicts(): Promise<McDict[]>
    currentDict(): Promise<'ipadic' | 'unidic'>
  }
  dict: {
    listDicts(): Promise<DictInfo[]>
  }
  anki: {
    ping(): Promise<AnkiPing>
    getSettings(): Promise<AnkiSettings>
    deckNames(): Promise<string[]>
    modelNames(): Promise<string[]>
    modelFieldNames(modelName: string): Promise<string[]>
  }
  knowledge: {
    getSettings(): Promise<PublicKnowledgeSettings>
    syncStatus(): Promise<SyncStatus>
  }
  integration: {
    binaryStatus(): Promise<BundledBinaryStatus>
  }
}

export interface OptionsDataController {
  /** Current cached state for `domain`; never throws, never triggers a fetch. */
  getState<D extends OptionsDomain>(domain: D): DomainState<OptionsDomainData[D]>
  /**
   * Loads `domain`. A `ready` domain is a no-op unless `force` is set; a load
   * already in flight is joined rather than duplicated (unless `force`).
   * One domain's rejection never touches another domain's state.
   */
  load(domain: OptionsDomain, options?: { force?: boolean }): Promise<void>
  /** Registers `listener`, called after every state transition; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
}

function idleState<T>(): DomainState<T> {
  return { status: 'idle', data: undefined, error: undefined }
}

/** Sentinel a fetcher returns to mean "a newer request for this domain has
 * since started" — runLoad leaves the domain's state exactly as-is rather
 * than committing a superseded result. */
const STALE = Symbol('stale')

/**
 * What a fetcher commits: the domain's new data, plus a user-facing error when
 * the load only partially succeeded. `error` set means the state lands in
 * `'error'` while still committing the `data` that *did* load.
 */
interface FetchOutcome {
  data: unknown
  error?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Owns the Options dialog's optional-integration data (MeCab/Yomitan
 * dictionaries, Anki connection + deck/model/field lists, knowledge sync
 * settings/status) behind a small per-domain cache, so opening a tab that
 * was already loaded is instant and a failing domain (e.g. Anki not running)
 * can't block the others from loading.
 */
export function createOptionsDataController(bridge: OptionsDataBridge): OptionsDataController {
  // Untyped-by-domain internally (TS can't correlate a mapped type's value
  // with a generic key across an assignment — microsoft/TypeScript#30581);
  // the public getState<D>() below is the one place that casts back to the
  // domain-specific shape callers actually see.
  const states: Record<OptionsDomain, DomainState<unknown>> = {
    dictionaries: idleState(),
    anki: idleState(),
    knowledge: idleState(),
    setup: idleState()
  }
  const inFlight: Partial<Record<OptionsDomain, Promise<void>>> = {}
  const listeners = new Set<() => void>()

  function notify(): void {
    listeners.forEach((listener) => listener())
  }

  // Bumped at the start of every anki-domain fetch attempt (before any
  // await), so it reflects invocation order rather than resolution order.
  // A fetch whose modelFieldNames() call is still in flight when a later
  // attempt starts (e.g. the user picks a different note type before the
  // first pick's field list has loaded) discards its own result instead of
  // clobbering the newer attempt's fields.
  let ankiRequestSeq = 0

  const fetchers: Record<
    OptionsDomain,
    (previous: unknown) => Promise<FetchOutcome | typeof STALE>
  > = {
    dictionaries: async () => {
      const [mecabDicts, currentMecabDictId, yomitanDicts] = await Promise.all([
        bridge.mecab.listDicts(),
        bridge.mecab.currentDict(),
        bridge.dict.listDicts()
      ])
      return { data: { mecabDicts, currentMecabDictId, yomitanDicts } }
    },
    // `getSettings()` reads the local settings file; `deckNames`/`modelNames`/
    // `modelFieldNames` all go over the wire to AnkiConnect. Awaiting them
    // together would discard the settings whenever Anki is unreachable, so a
    // change saved while Anki is down is persisted on disk but visually
    // reverts in the dialog. The two halves are therefore settled
    // independently: the settings are always committed, and a failing list
    // call only keeps the previous lists and surfaces the error.
    anki: async (previous) => {
      const seq = ++ankiRequestSeq
      const prior = previous as AnkiData | undefined
      const listsPromise = Promise.all([bridge.anki.deckNames(), bridge.anki.modelNames()])
        .then(([deckNames, modelNames]) => ({
          deckNames: deckNames as string[] | undefined,
          modelNames: modelNames as string[] | undefined,
          error: undefined as string | undefined
        }))
        .catch((error: unknown) => ({
          deckNames: undefined,
          modelNames: undefined,
          error: errorMessage(error)
        }))
      const settings = await bridge.anki.getSettings()
      const lists = await listsPromise
      if (seq !== ankiRequestSeq) return STALE

      // Every cached list describes the endpoint it was read from, so it may
      // only be reused while the connection-defining settings are unchanged.
      // The dialog force-reloads this domain right after a URL or API-key
      // save; if the new endpoint is unreachable, showing the old server's
      // decks and note types under the new URL would let the user save
      // selections that need not exist there at all.
      const cached =
        prior !== undefined &&
        prior.settings.url === settings.url &&
        prior.settings.apiKey === settings.apiKey
          ? prior
          : undefined
      const deckNames = lists.deckNames ?? cached?.deckNames ?? []
      const modelNames = lists.modelNames ?? cached?.modelNames ?? []
      const listsError = lists.error

      // Cached fields carry the extra condition that the note type itself is
      // unchanged — a reload that follows a note-type change must not show the
      // previous model's fields under the new model's name.
      const cachedModelFields =
        cached !== undefined && cached.settings.modelName === settings.modelName
          ? cached.modelFields
          : []

      let modelFields: string[] = []
      let fieldsError: string | undefined
      if (settings.modelName !== '') {
        if (listsError !== undefined) {
          // The same connection the lists just failed on — asking for the
          // fields would only add a second failing request.
          modelFields = cachedModelFields
        } else {
          try {
            modelFields = await bridge.anki.modelFieldNames(settings.modelName)
          } catch (error: unknown) {
            modelFields = cachedModelFields
            fieldsError = errorMessage(error)
          }
        }
      }
      if (seq !== ankiRequestSeq) return STALE
      return {
        data: { settings, deckNames, modelNames, modelFields },
        error: listsError ?? fieldsError
      }
    },
    knowledge: async () => {
      const [settings, syncStatus] = await Promise.all([
        bridge.knowledge.getSettings(),
        bridge.knowledge.syncStatus()
      ])
      return { data: { settings, syncStatus } }
    },
    // A down Anki is the *normal* answer this tab exists to report, not a
    // failure of the load: the ping's rejection is folded into an `ok: false`
    // reading so the binary statuses still render and the tab never shows an
    // error banner for something it is supposed to display as a status dot.
    setup: async () => {
      const [binaries, anki] = await Promise.all([
        bridge.integration.binaryStatus(),
        bridge.anki.ping().catch((error: unknown) => ({ ok: false, error: errorMessage(error) }))
      ])
      return { data: { binaries, anki } }
    }
  }

  function runLoad(domain: OptionsDomain, forced: boolean): Promise<void> {
    if (!forced) {
      if (states[domain].status === 'ready') return Promise.resolve()
      const existing = inFlight[domain]
      if (existing) return existing
    }

    const previousData = states[domain].data
    states[domain] = { status: 'loading', data: previousData, error: undefined }
    notify()

    const run: Promise<void> = fetchers[domain](previousData)
      .then((outcome) => {
        if (outcome === STALE) return
        states[domain] = {
          status: outcome.error === undefined ? 'ready' : 'error',
          data: outcome.data,
          error: outcome.error
        }
      })
      .catch((error: unknown) => {
        states[domain] = {
          status: 'error',
          data: previousData,
          error: errorMessage(error)
        }
      })
      .finally(() => {
        if (inFlight[domain] === run) delete inFlight[domain]
        notify()
      })

    inFlight[domain] = run
    return run
  }

  return {
    getState<D extends OptionsDomain>(domain: D): DomainState<OptionsDomainData[D]> {
      return states[domain] as DomainState<OptionsDomainData[D]>
    },

    load(domain, options): Promise<void> {
      return runLoad(domain, options?.force ?? false)
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
