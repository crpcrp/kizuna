import { clamp } from '../../../shared/math'
import { type FrequencyMode, type LookupResult } from '../../../shared/dictionary'
import { extendTeFormAuxiliaries } from '../../../shared/inflection'
import { type Token } from '../../../shared/token'

/** Anchor position (viewport px) the word popup renders near. */
export interface WordPopupPosition {
  x: number
  y: number
  placement?: 'above' | 'below'
}

export interface WordPopupAnchorRect {
  left: number
  top: number
  width: number
  height: number
}

/** Optional cue-independent context supplied by surfaces such as Game OCR. */
export interface WordPopupTextContext {
  /** The independent text instance that owns the clicked token. */
  textId: string
  /** Every token in that text instance, never tokens from a neighboring box. */
  tokens: Token[]
  sentence: string
  /** The hovered/clicked text element's viewport rectangle, when measurable. */
  anchorRect?: WordPopupAnchorRect
}

// Use the maximum WordPopup.css dimensions so even the largest popup stays inside the viewport.
const WORD_POPUP_MAX_WIDTH = 440
const GAME_OCR_WORD_POPUP_MAX_HEIGHT_RATIO = 0.28
const WORD_POPUP_GAP = 14

// Anchor above the whole subtitle box so moving between tokens does not move the popup.
export function wordPopupPosition(
  subtitleRect: WordPopupAnchorRect | undefined,
  event?: { clientX: number; clientY: number }
): WordPopupPosition {
  if (subtitleRect) return { x: subtitleRect.left + subtitleRect.width / 2, y: subtitleRect.top }
  if (event) return { x: event.clientX, y: event.clientY }
  return { x: 0, y: 0 }
}

export function gameOcrWordPopupPosition(
  anchorRect: WordPopupAnchorRect | undefined,
  event: { clientX: number; clientY: number } | undefined,
  viewport: { width: number; height: number }
): WordPopupPosition {
  const width = Math.min(WORD_POPUP_MAX_WIDTH, Math.max(0, viewport.width * 0.9))
  const popupHeight = Math.min(
    Math.max(0, viewport.height),
    Math.max(0, viewport.height * GAME_OCR_WORD_POPUP_MAX_HEIGHT_RATIO)
  )
  const xMin = width / 2
  const xMax = Math.max(xMin, viewport.width - width / 2)
  const fallback = wordPopupPosition(undefined, event)
  const x = anchorRect ? anchorRect.left + anchorRect.width / 2 : fallback.x
  const anchorTop = anchorRect?.top ?? fallback.y
  const anchorBottom = anchorRect ? anchorRect.top + anchorRect.height : fallback.y
  const spaceAbove = anchorTop - WORD_POPUP_GAP
  const spaceBelow = viewport.height - anchorBottom - WORD_POPUP_GAP
  const placement =
    spaceBelow >= popupHeight || spaceBelow >= spaceAbove ? ('below' as const) : ('above' as const)

  const y =
    placement === 'below'
      ? clamp(anchorBottom, 0, Math.max(0, viewport.height - popupHeight - WORD_POPUP_GAP))
      : clamp(anchorTop, Math.min(viewport.height, popupHeight + WORD_POPUP_GAP), viewport.height)
  return {
    x: clamp(x, xMin, xMax),
    y,
    placement
  }
}

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

export interface WordLookupRequest {
  lemma: string
  reading: string | undefined
  frequencyDictId: number | null
  sortMode: FrequencyMode | undefined
  longestMatchCandidates: string[] | undefined
  surface: string
}

// MeCab can split dictionary compounds (閻魔/大王); try merged spans and code-point-safe internal prefixes.
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

  // Only trim short conjugated tails: prefixes of 行きたければ are fragments, not plausible word boundaries.
  const codePoints = Array.from(clickedToken.surface)
  const lemmaLength = Array.from(clickedToken.lemma).length
  if (codePoints.length - lemmaLength <= 2) {
    for (let length = codePoints.length - 1; length > 0; length--) {
      candidates.add(codePoints.slice(0, length).join(''))
    }
  }
  return [...candidates]
}

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

// Highlight the full matched compound, even when the click landed on just its first MeCab token.
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

// With auto sort order, omit the override so the dictionary chooses its rank or occurrence mode.
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
  const highlightedTokens = extendTeFormAuxiliaries(
    cueTokens,
    results.length > 0 ? resolvePopupHighlightSpan(cueTokens, token, results[0]) : [token]
  )
  return { results, position, highlightedTokens }
}

// Glossary links have no cue tokens; look up the target as-is without compound expansion.
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
