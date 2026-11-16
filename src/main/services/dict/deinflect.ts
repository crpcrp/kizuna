interface DeinflectRule {
  suffix: string
  replacement: string
}

// Try longer, more specific suffixes first; all matching rules contribute candidates.
const DEINFLECT_RULES: DeinflectRule[] = [
  // Without conjugation-class information, polite stems need both ichidan and godan guesses.
  { suffix: 'ました', replacement: '' },
  { suffix: 'ません', replacement: '' },
  { suffix: 'ます', replacement: '' },
  // Negative
  { suffix: 'ない', replacement: 'る' },
  // Potential / passive-causative overlap (both -られる/-れる undo to -る)
  { suffix: 'られる', replacement: 'る' },
  { suffix: 'れる', replacement: 'る' },
  // Want-to
  { suffix: 'たい', replacement: 'る' },
  // Past / te-form (ichidan: 食べた/食べて -> 食べる)
  { suffix: 'た', replacement: 'る' },
  { suffix: 'て', replacement: 'る' }
]

/** Godan ます-stem (ren'youkei) final kana -> dictionary-form (-u row) final kana. */
const STEM_TO_DICTIONARY_ENDING: Record<string, string> = {
  い: 'う',
  ち: 'つ',
  り: 'る',
  き: 'く',
  ぎ: 'ぐ',
  し: 'す',
  び: 'ぶ',
  み: 'む',
  に: 'ぬ'
}

// Potential/passive and negative suffixes attach to the a-row stem (飲ま),
// unlike polite suffixes, which attach to the i-row stem (飲み).
const MIZENKEI_TO_DICTIONARY_ENDING: Record<string, string> = {
  あ: 'う',
  か: 'く',
  が: 'ぐ',
  さ: 'す',
  た: 'つ',
  な: 'ぬ',
  ば: 'ぶ',
  ま: 'む',
  ら: 'る'
}

function stemToCandidates(stem: string, endingMap: Record<string, string>): string[] {
  if (stem.length === 0) return []
  const candidates = [`${stem}る`]
  const lastKana = stem[stem.length - 1]
  const godanEnding = endingMap[lastKana]
  if (godanEnding) {
    candidates.push(`${stem.slice(0, -1)}${godanEnding}`)
  }
  return candidates
}

export function stemToDictionaryForms(stem: string): string[] {
  return stemToCandidates(stem, STEM_TO_DICTIONARY_ENDING)
}

function stemToMizenkeiDictionaryForms(stem: string): string[] {
  return stemToCandidates(stem, MIZENKEI_TO_DICTIONARY_ENDING)
}

// Suffix stripping can produce false positives; dictionary lookup filters them.
// Keep the original surface first because it may already be a headword.
export function deinflect(surface: string): string[] {
  const candidates = new Set<string>([surface])

  for (const rule of DEINFLECT_RULES) {
    if (!surface.endsWith(rule.suffix)) continue
    const stem = surface.slice(0, surface.length - rule.suffix.length)
    if (rule.suffix === 'ました' || rule.suffix === 'ません' || rule.suffix === 'ます') {
      for (const candidate of stemToDictionaryForms(stem)) {
        candidates.add(candidate)
      }
    } else if (rule.suffix === 'ない' || rule.suffix === 'られる' || rule.suffix === 'れる') {
      for (const candidate of stemToMizenkeiDictionaryForms(stem)) {
        candidates.add(candidate)
      }
    } else {
      candidates.add(`${stem}${rule.replacement}`)
    }
  }

  return Array.from(candidates)
}
