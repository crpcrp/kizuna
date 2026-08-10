// Dictionary lookup for the word popup: building the lookup request from a
// clicked token, resolving which characters the popup should highlight, and the
// two lookup entry points (a clicked word, and a cross-reference link inside an
// already-open popup).

import { type FrequencyMode, type LookupResult } from '../../../shared/dictionary'
import { type Token } from '../../../shared/token'

/** Anchor position (viewport px) the word popup renders near. */
export interface WordPopupPosition {
  x: number
  y: number
}

/** The part of a DOMRect needed to anchor a popup to interactive text. */
export interface WordPopupAnchorRect {
  left: number
  top: number
  width: number
}

/** Optional cue-independent context supplied by surfaces such as Game OCR. */
export interface WordPopupTextContext {
  /** The independent text instance that owns the clicked token. */
  textId: string
  /** Every token in that text instance, never tokens from a neighboring box. */
  tokens: Token[]
  /** The original text used as dictionary sentence context. */
  sentence: string
  /** The hovered/clicked text element's viewport rectangle, when measurable. */
  anchorRect?: WordPopupAnchorRect
}

/**
 * Maximum popup dimensions from WordPopup.css. Keeping the worst-case box
 * inside the viewport also keeps a short result inside it.
 */
const WORD_POPUP_MAX_WIDTH = 440
const WORD_POPUP_MAX_HEIGHT_RATIO = 0.55
const WORD_POPUP_GAP = 14

/**
 * Pure: computes the word popup's anchor position. Prefers the subtitle
 * box's own rect (so the popup anchors above the whole subtitle line,
 * staying stable across every token in it) and falls back to the
 * triggering mouse event's coordinates when the box isn't available, then
 * to {0,0} when neither is (e.g. hover fired with no event).
 */
export function wordPopupPosition(
  subtitleRect: WordPopupAnchorRect | undefined,
  event?: { clientX: number; clientY: number }
): WordPopupPosition {
  if (subtitleRect) return { x: subtitleRect.left + subtitleRect.width / 2, y: subtitleRect.top }
  if (event) return { x: event.clientX, y: event.clientY }
  return { x: 0, y: 0 }
}

/**
 * Keeps a popup anchored above its target while reserving the maximum space
 * the fixed popup can occupy. This is used for OCR boxes, whose anchors can
 * be at any display edge; the existing subtitle position remains unchanged.
 */
export function constrainWordPopupPosition(
  position: WordPopupPosition,
  viewport: { width: number; height: number }
): WordPopupPosition {
  const width = Math.min(WORD_POPUP_MAX_WIDTH, Math.max(0, viewport.width * 0.9))
  const height = Math.min(
    Math.max(0, viewport.height),
    Math.max(0, viewport.height * WORD_POPUP_MAX_HEIGHT_RATIO)
  )
  const xMin = width / 2
  const xMax = Math.max(xMin, viewport.width - width / 2)
  const yMin = Math.min(viewport.height, height + WORD_POPUP_GAP)
  const yMax = Math.max(yMin, viewport.height)
  return {
    x: clamp(position.x, xMin, xMax),
    y: clamp(position.y, yMin, yMax)
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

/** Subset of the preload `kizuna.dict` bridge that lookupWordPopup needs. */
export interface DictLookupBridge {
  lookup(
    lemma: string,
    reading?: string,
    freqDictId?: number | null,
    sortMode?: FrequencyMode,
    longestMatchCandidates?: string[],
    surface?: string
  ): Promise<LookupResult[]>
}

/** The complete, serializable input to one dictionary lookup. */
export interface WordLookupRequest {
  lemma: string
  reading: string | undefined
  frequencyDictId: number | null
  sortMode: FrequencyMode | undefined
  longestMatchCandidates: string[] | undefined
  surface: string
}

/**
 * Builds longest-match compound candidates for a clicked/hovered token,
 * given the full token list for the cue it belongs to. MeCab segments purely
 * by its own grammar rules, so a dictionary headword that's a compound of
 * several MeCab tokens (e.g. 閻魔大王 segmented as 閻魔/大王) is invisible to a
 * lookup keyed on just `clickedToken`'s own lemma. Returns merged-surface
 * strings and, for multi-token spans whose final token is inflected, a
 * final-token lemma variant. Both start at `clickedToken`, longest (up to
 * `maxTokens`) down to the clicked token itself. It then appends shorter prefixes within the
 * clicked token, longest first. `Array.from` keeps those prefixes on Unicode
 * code-point boundaries, so supplementary characters are never split. This
 * lets a dictionary entry such as `閻` be found when MeCab emits `閻魔`.
 * Returns `[]` if `clickedToken` isn't found in `cueTokens` (matched by
 * `startOffset`, which is unique within a cue).
 */
export function buildLongestMatchCandidates(
  cueTokens: Token[],
  clickedToken: Token,
  maxTokens = 8
): string[] {
  const startIndex = cueTokens.findIndex((t) => t.startOffset === clickedToken.startOffset)
  if (startIndex === -1) return []

  const endIndex = Math.min(cueTokens.length, startIndex + maxTokens)
  const candidates = new Set<string>()
  for (let end = endIndex; end > startIndex; end--) {
    const spanTokens = cueTokens.slice(startIndex, end)
    candidates.add(spanTokens.map((token) => token.surface).join(''))
    if (spanTokens.length > 1) {
      const last = spanTokens[spanTokens.length - 1]
      if (last.lemma !== '' && last.lemma !== last.surface) {
        candidates.add(
          spanTokens
            .slice(0, -1)
            .map((token) => token.surface)
            .join('') + last.lemma
        )
      }
    }
  }

  // Internal prefixes only hold up as plausible word boundaries when the
  // surface's conjugated tail beyond the lemma is short (e.g. 食べた's -た,
  // or 良かろう's archaic -かろう). A heavily conjugated form like
  // 行きたければ (lemma 行く, four characters of tail beyond it) doesn't trim
  // down to real word boundaries -- 行き, 行 are just fragments of the
  // conjugation and must not outrank the complete surface or the MeCab lemma
  // in the popup.
  const codePoints = Array.from(clickedToken.surface)
  const lemmaLength = Array.from(clickedToken.lemma).length
  if (codePoints.length - lemmaLength <= 2) {
    for (let length = codePoints.length - 1; length > 0; length--) {
      candidates.add(codePoints.slice(0, length).join(''))
    }
  }
  return [...candidates]
}

/** Builds the dictionary request shared by popup and whole-track lookups. */
export function buildWordLookupRequest(
  token: Token,
  freqDictId: number | null,
  sortOrder: 'auto' | FrequencyMode | undefined,
  cueTokens: Token[] = []
): WordLookupRequest {
  const compoundCandidates = buildLongestMatchCandidates(cueTokens, token)
  const candidates =
    token.surface !== token.lemma && !compoundCandidates.includes(token.surface)
      ? [...compoundCandidates, token.surface]
      : compoundCandidates
  return {
    lemma: token.lemma,
    reading: token.reading || undefined,
    frequencyDictId: freqDictId,
    sortMode: sortOrder && sortOrder !== 'auto' ? sortOrder : undefined,
    longestMatchCandidates: candidates.length > 0 ? candidates : undefined,
    surface: token.surface
  }
}

/** Performs a previously built dictionary request. */
export function lookupWord(
  bridge: DictLookupBridge,
  request: WordLookupRequest
): Promise<LookupResult[]> {
  return bridge.lookup(
    request.lemma,
    request.reading,
    request.frequencyDictId,
    request.sortMode,
    request.longestMatchCandidates,
    request.surface
  )
}

/**
 * Given the resolved `expression` a lookup matched on (e.g. `results[0].expression`),
 * finds the contiguous run of tokens starting at `clickedToken` whose
 * concatenated surface or lemmas equal it — so the UI can visually highlight the same
 * compound the popup's content actually describes (e.g. highlight both 閻魔
 * and 大王 when the popup is showing the 閻魔大王 entry, even though the click
 * landed on the 閻魔 token alone). Falls back to `[clickedToken]` when
 * `expression` doesn't correspond to any prefix run of `cueTokens`' surfaces
 * — the ordinary case where the match came from `token.lemma` itself (with or
 * without deinflection), not a `buildLongestMatchCandidates` compound hit.
 */
export function matchedTokenSpan(
  cueTokens: Token[],
  clickedToken: Token,
  expression: string
): Token[] {
  const startIndex = cueTokens.findIndex((t) => t.startOffset === clickedToken.startOffset)
  if (startIndex === -1) return [clickedToken]

  let mergedSurface = ''
  let mergedLemma = ''
  for (let end = startIndex; end < cueTokens.length; end++) {
    mergedSurface += cueTokens[end].surface
    mergedLemma += cueTokens[end].lemma
    if (mergedSurface === expression || mergedLemma === expression) {
      return cueTokens.slice(startIndex, end + 1)
    }
    if (mergedSurface.length >= expression.length && mergedLemma.length >= expression.length) break
  }
  return [clickedToken]
}

const INFLECTION_CONTINUATIONS = new Set(['て', 'で', 'ば', 'たり', 'だり', 'そう'])

/** Resolves the subtitle span described by a popup result, including split inflections. */
export function resolvePopupHighlightSpan(
  cueTokens: Token[],
  clickedToken: Token,
  result: Pick<LookupResult, 'expression' | 'matchedSurface'>
): Token[] {
  if (result.matchedSurface) {
    const matched = matchedTokenSpan(cueTokens, clickedToken, result.matchedSurface)
    if (matched.length > 1 || matched[0]?.surface === result.matchedSurface) return matched
  }

  const exact = matchedTokenSpan(cueTokens, clickedToken, result.expression)
  if (exact.length > 1) {
    if (exact.map((token) => token.surface).join('') === result.expression) return exact
    const endIndex = cueTokens.findIndex((token) => token.startOffset === exact.at(-1)?.startOffset)
    const extended = [...exact]
    for (let index = endIndex + 1; index < cueTokens.length; index++) {
      const token = cueTokens[index]
      if (!token.pos.includes('助動詞') && !INFLECTION_CONTINUATIONS.has(token.surface)) break
      extended.push(token)
    }
    return extended
  }
  if (result.expression === clickedToken.surface || result.expression === clickedToken.lemma)
    return exact

  const startIndex = cueTokens.findIndex((token) => token.startOffset === clickedToken.startOffset)
  if (startIndex === -1) return [clickedToken]

  const span = [clickedToken]
  let surface = clickedToken.surface
  let diverged = !result.expression.startsWith(surface)
  let inflectionClosed = false
  let addedMainVerbs = 0
  for (let index = startIndex + 1; index < cueTokens.length; index++) {
    const token = cueTokens[index]
    const nextSurface = surface + token.surface
    const isVerb = token.pos.includes('動詞') && !token.pos.includes('助動詞')
    const isSuffix = token.pos.includes('助動詞') || INFLECTION_CONTINUATIONS.has(token.surface)
    if (!diverged && result.expression.startsWith(nextSurface)) {
      if (isVerb && addedMainVerbs >= 1) break
      span.push(token)
      surface = nextSurface
      if (isVerb) addedMainVerbs++
      continue
    }

    const continuesInflection = isSuffix || (isVerb && !inflectionClosed && addedMainVerbs < 1)
    if (!continuesInflection) break

    span.push(token)
    surface = nextSurface
    diverged = true
    if (isVerb) addedMainVerbs++
    if (isSuffix) inflectionClosed = true
  }
  return span
}

/**
 * Looks up `token`'s dictionary entries and resolves the popup payload
 * (results + the already-computed anchor position + which tokens to visually
 * highlight) for the caller to store in state. Shared by both App.tsx's
 * hover-settle callback and its click handler, so both paths open the same
 * popup shape. `sortOrder: 'auto'` (or omitted) forwards no override, so the
 * main-process lookup falls back to the frequency dictionary's own
 * rank-based/occurrence-based mode. `cueTokens` (the full token list for the
 * active cue, if available) is used both to build longest-match compound
 * candidates (`buildLongestMatchCandidates`) and, once results come back, to
 * resolve `highlightedTokens` (`matchedTokenSpan`) — so the highlighted span
 * always matches whichever word the popup ends up displaying.
 */
export async function lookupWordPopup(
  bridge: DictLookupBridge,
  token: Token,
  position: WordPopupPosition,
  freqDictId: number | null,
  sortOrder?: 'auto' | FrequencyMode,
  cueTokens: Token[] = []
): Promise<{ results: LookupResult[]; position: WordPopupPosition; highlightedTokens: Token[] }> {
  const results = await lookupWord(
    bridge,
    buildWordLookupRequest(token, freqDictId, sortOrder, cueTokens)
  )
  const highlightedTokens =
    results.length > 0 ? resolvePopupHighlightSpan(cueTokens, token, results[0]) : [token]
  return { results, position, highlightedTokens }
}

/**
 * Looks up a glossary cross-reference link's target term directly (see
 * WordPopup.tsx's `onLinkClick`/`parseInternalLinkQuery`) — unlike
 * `lookupWordPopup`, `expression` isn't a subtitle `Token`, so there are no
 * `cueTokens` to build longest-match candidates from or highlight; it's
 * looked up as-is, same as a single-token `lookup()` fallback.
 */
export async function lookupLinkedWord(
  bridge: DictLookupBridge,
  expression: string,
  freqDictId: number | null,
  sortOrder?: 'auto' | FrequencyMode
): Promise<LookupResult[]> {
  return bridge.lookup(
    expression,
    undefined,
    freqDictId,
    sortOrder && sortOrder !== 'auto' ? sortOrder : undefined
  )
}
