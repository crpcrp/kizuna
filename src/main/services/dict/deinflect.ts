// A small Yomitan-style deinflection table: pure string manipulation that turns a
// conjugated surface form into dictionary-form candidates. Knows nothing about the
// database, so a change to conjugation handling stays inside this module.

/** One suffix-stripping deinflection rule: `surface` ending in `suffix` may be
 * reconstructed by replacing it with `replacement` (e.g. undoing a conjugation). */
interface DeinflectRule {
  suffix: string
  replacement: string
}

/**
 * Ordered, longest-suffix-first rule table. Order matters only in that longer/more
 * specific suffixes should be tried before shorter ones they contain (e.g. the
 * `ました` rule vs a hypothetical bare `た` rule) so the more specific candidate is
 * also produced; since we collect ALL matching candidates (not just the first
 * match), strict ordering isn't load-bearing here, but longest-first keeps the
 * candidate list's earlier entries the more plausible ones.
 */
const DEINFLECT_RULES: DeinflectRule[] = [
  // Polite forms (ます-stem verbs): 飲みました/飲みません/飲みます -> 飲む is NOT
  // reachable by simple suffix-replacement alone (stem+u isn't a fixed suffix
  // swap), so we approximate by stripping the polite suffix and appending 'う'
  // family endings via the stem. Since a true stem->dictionary-form mapping
  // needs conjugation-class knowledge we don't have, keep this pragmatic: strip
  // the polite suffix down to the ます-stem, then offer stem+u as a guess for
  // godan verbs whose stem ends in an i-row kana that maps to a u-row ending.
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

/**
 * Godan mizenkei (a-row) stem final kana -> dictionary-form (-u row) final kana.
 * This is the stem that -れる/-られる (potential/passive) and -ない (negative)
 * attach to (e.g. 飲む -> 飲ま + れる/ない), which is a DIFFERENT base than the
 * ます-stem above (e.g. 飲む -> 飲み + ます) and therefore needs its own mapping.
 */
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

/**
 * Given a bare stem (conjugation suffix already stripped) and a stem-ending ->
 * dictionary-ending map, return dictionary-form candidates: the ichidan guess
 * (stem + る) and, if the stem's final kana is in the map, the godan guess (swap
 * final kana to its u-row counterpart).
 */
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

/** Ren'youkei (ます-stem) -> dictionary-form candidates. See `STEM_TO_DICTIONARY_ENDING`. */
export function stemToDictionaryForms(stem: string): string[] {
  return stemToCandidates(stem, STEM_TO_DICTIONARY_ENDING)
}

/** Mizenkei (a-row) stem -> dictionary-form candidates. See `MIZENKEI_TO_DICTIONARY_ENDING`. */
function stemToMizenkeiDictionaryForms(stem: string): string[] {
  return stemToCandidates(stem, MIZENKEI_TO_DICTIONARY_ENDING)
}

/**
 * Returns plausible dictionary-form (lemma) candidates for a conjugated surface
 * form, by undoing one common conjugation step at a time. Pure string
 * suffix-stripping — no morphological analysis, so false-positive candidates are
 * expected and should simply miss in the DB lookup. Always includes `surface`
 * itself as the first candidate (identity), since a token may already be a
 * dictionary headword and not need deinflection at all.
 */
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
