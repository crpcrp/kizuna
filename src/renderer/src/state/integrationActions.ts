import type { OptionsCategory } from '../components/OptionsMenu'
import type { OptionsDataController, OptionsDomain } from './optionsData'
import type { AnkiSettings } from '../../../shared/anki'
import type { PublicKnowledgeSettings, SyncStatus } from '../../../shared/knowledge'
import type { ImportResult } from '../../../shared/dictionary'
import {
  invalidateTokenizationForDictionaryChange,
  type TokenizationInvalidationArgs
} from './tokenizationInvalidation'
import { syncAndRefreshKnowledge, type SyncAndRefreshKnowledgeArgs } from './knowledgeActions'

/** Which options-data domain(s) a category needs loaded when it's shown.
 * Keybindings/playback/subtitles need none. Known Words also loads the
 * (cached, unforced) Anki domain for its deck checkboxes and field select. */
export function domainsForCategory(category: OptionsCategory): OptionsDomain[] {
  switch (category) {
    case 'dictionaries':
      return ['dictionaries']
    case 'anki':
      return ['anki']
    case 'knowledge':
      return ['knowledge', 'anki']
    // The read-only status page reports on all three: its own live signals
    // (bundled binaries, AnkiConnect ping), plus the dictionary and WaniKani
    // state the other tabs already load.
    case 'setup':
      return ['setup', 'dictionaries', 'knowledge']
    default:
      return []
  }
}

/** Domains whose cached value would be *stale as a status report* rather than
 * merely old: whether Anki answers right now, and whether a binary has since
 * been dropped into `resources/`, are exactly what the Setup tab claims to
 * show, so it re-probes on every open instead of trusting the cache. */
const ALWAYS_REFRESHED: OptionsDomain[] = ['setup']

/** Lazily loads an Options category's domain(s) when it's shown, instead of
 * fetching every optional integration at app startup. */
export function loadCategoryDomains(
  optionsData: OptionsDataController,
  category: OptionsCategory
): void {
  for (const domain of domainsForCategory(category)) {
    void optionsData.load(domain, { force: ALWAYS_REFRESHED.includes(domain) })
  }
}

export interface MecabDictSelectBridge {
  selectDict(id: 'ipadic' | 'unidic'): Promise<'ipadic' | 'unidic'>
}

export interface SelectMecabDictArgs extends Omit<TokenizationInvalidationArgs, 'mecab'> {
  mecab: TokenizationInvalidationArgs['mecab'] & MecabDictSelectBridge
  optionsData: OptionsDataController
  id: 'ipadic' | 'unidic'
}

/** Switches the active MeCab dictionary: persists the choice, refreshes the
 * cached dictionaries list, then invalidates every cached tokenization and
 * re-tokenizes so the subtitle reflects the new dictionary immediately. */
export async function selectMecabDict(args: SelectMecabDictArgs): Promise<void> {
  await args.mecab.selectDict(args.id)
  void args.optionsData.load('dictionaries', { force: true })
  await invalidateTokenizationForDictionaryChange(args)
}

export interface DictImportBridge {
  importDict(zipBytes: Uint8Array): Promise<ImportResult>
}

/** Imports a Yomitan dictionary zip, then refreshes the cached list. */
export async function importYomitanDict(
  dict: DictImportBridge,
  optionsData: OptionsDataController,
  bytes: Uint8Array
): Promise<void> {
  await dict.importDict(bytes)
  await optionsData.load('dictionaries', { force: true })
}

export interface DictEnableBridge {
  setEnabled(id: number, enabled: boolean): Promise<void>
}

export async function setYomitanEnabled(
  dict: DictEnableBridge,
  optionsData: OptionsDataController,
  id: number,
  enabled: boolean
): Promise<void> {
  await dict.setEnabled(id, enabled)
  await optionsData.load('dictionaries', { force: true })
}

export interface DictFallbackOnlyBridge {
  setFallbackOnly(id: number, fallbackOnly: boolean): Promise<void>
}

/** Sets whether a dictionary is shown only after ordinary lookup results,
 * then refreshes the cached dictionaries list. */
export async function setYomitanFallbackOnly(
  dict: DictFallbackOnlyBridge,
  optionsData: OptionsDataController,
  id: number,
  fallbackOnly: boolean
): Promise<void> {
  await dict.setFallbackOnly(id, fallbackOnly)
  await optionsData.load('dictionaries', { force: true })
}

export interface DictReorderBridge {
  reorder(orderedIds: number[]): Promise<void>
}

export async function reorderYomitanDicts(
  dict: DictReorderBridge,
  optionsData: OptionsDataController,
  orderedIds: number[]
): Promise<void> {
  await dict.reorder(orderedIds)
  await optionsData.load('dictionaries', { force: true })
}

export interface DictRemoveBridge {
  removeDict(id: number): Promise<void>
}

export async function removeYomitanDict(
  dict: DictRemoveBridge,
  optionsData: OptionsDataController,
  id: number
): Promise<void> {
  await dict.removeDict(id)
  await optionsData.load('dictionaries', { force: true })
}

export interface WanikaniTokenBridge {
  setSettings(patch: { wanikaniToken: string }): Promise<PublicKnowledgeSettings>
}

export async function saveWanikaniToken(
  knowledge: WanikaniTokenBridge,
  optionsData: OptionsDataController,
  token: string
): Promise<void> {
  await knowledge.setSettings({ wanikaniToken: token })
  await optionsData.load('knowledge', { force: true })
}

export interface AnkiSettingsBridge {
  setSettings(patch: Partial<AnkiSettings>): Promise<AnkiSettings>
}

export async function changeAnkiSettings(
  anki: AnkiSettingsBridge,
  optionsData: OptionsDataController,
  patch: Partial<AnkiSettings>
): Promise<void> {
  await anki.setSettings(patch)
  await optionsData.load('anki', { force: true })
}

export interface KnowledgeSettingsBridge {
  setSettings(
    patch: Partial<Omit<PublicKnowledgeSettings, 'hasWanikaniToken' | 'encryptionAvailable'>>
  ): Promise<PublicKnowledgeSettings>
}

export async function changeKnowledgeSettings(
  knowledge: KnowledgeSettingsBridge,
  optionsData: OptionsDataController,
  patch: Partial<Omit<PublicKnowledgeSettings, 'hasWanikaniToken' | 'encryptionAvailable'>>
): Promise<void> {
  await knowledge.setSettings(patch)
  await optionsData.load('knowledge', { force: true })
}

/** Deck/field changes alter Anki membership; numeric thresholds intentionally do not sync per keystroke. */
export function shouldResyncAnkiForKnowledgePatch(
  patch: Partial<Omit<PublicKnowledgeSettings, 'hasWanikaniToken' | 'encryptionAvailable'>>
): boolean {
  return patch.ankiKnownDecks !== undefined || patch.ankiKnownField !== undefined
}

export interface SyncKnowledgeAndRefreshArgs extends SyncAndRefreshKnowledgeArgs {
  optionsData: OptionsDataController
}

/** Syncs knowledge sources and rebuilds visible levels (syncAndRefreshKnowledge),
 * then refreshes the Options dialog's cached knowledge domain (sync status/settings). */
export async function syncKnowledgeAndRefresh(
  args: SyncKnowledgeAndRefreshArgs
): Promise<SyncStatus> {
  const status = await syncAndRefreshKnowledge(args)
  await args.optionsData.load('knowledge', { force: true })
  return status
}
