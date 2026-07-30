import type { Cue } from '../../../shared/cue'
import type { FrequencyMode } from '../../../shared/dictionary'
import { cueKey } from './tokenization'
export interface WholeTrackVocabularyDependencies {
  filePath: string | null
  subtitleTrackId: number | null
  japaneseSubtitleSelected: boolean
  cues: Cue[]
  frequencyDictId: number | null
  sortOrder: 'auto' | FrequencyMode
  dictionarySettings: unknown
  knowledgeEpoch: number
}

/**
 * Identifies inputs that can change a whole-track vocabulary snapshot.
 * Anki configuration deliberately does not appear here: it only changes how
 * selected candidates are mined, never the vocabulary being prepared.
 */
export function wholeTrackVocabularyDependencyKey(input: WholeTrackVocabularyDependencies): string {
  return JSON.stringify({
    filePath: input.filePath,
    subtitleTrackId: input.subtitleTrackId,
    japaneseSubtitleSelected: input.japaneseSubtitleSelected,
    cues: input.cues.map(cueKey),
    frequencyDictId: input.frequencyDictId,
    sortOrder: input.sortOrder,
    dictionarySettings: input.dictionarySettings,
    knowledgeEpoch: input.knowledgeEpoch
  })
}
