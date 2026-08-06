import {
  maxKnowledgeLevel,
  type KnowledgeDetails,
  type KnowledgeLevel
} from '../../../shared/knowledge'
import { isGrammarToken, isSymbolToken, type Token } from '../../../shared/token'
import type { VocabularySpan } from './vocabularySpans'

export interface VocabularyUnitCue {
  cueKey: string
  text?: string
  tokens: Token[]
  spans?: VocabularySpan[]
  start?: number
  end?: number
}

export interface VocabularyUnit {
  /** Aggregation identity: the projected dictionary expression when the track
   * has one for this lemma, otherwise token.lemma. */
  key: string
  /** Surface of the first occurrence, for display. */
  surface: string
  /** First occurrence, with its cue context. */
  token: Token
  sentence: string
  cueStart?: number
  cueEnd?: number
  /** Occurrences of the unit (a compound counts once per span occurrence). */
  count: number
  /** Non-symbol tokens the unit covers across the track. */
  tokenCount: number
  level: KnowledgeLevel
  grammar: boolean
  /** First-occurrence index in cue order, for deterministic ties. */
  order: number
}

type UnitLevelCounts = Record<KnowledgeLevel, number>

interface UnitMetadata {
  /** Preserves projected-span token weighting when occurrences have levels that differ. */
  tokenLevels: UnitLevelCounts
  identities: Set<string>
}

const metadataByUnit = new WeakMap<VocabularyUnit, UnitMetadata>()

/** Returns the per-token levels accumulated while deriving a vocabulary unit. */
export function vocabularyUnitTokenLevels(unit: VocabularyUnit): UnitLevelCounts {
  return (
    metadataByUnit.get(unit)?.tokenLevels ?? {
      unknown: unit.level === 'unknown' ? unit.tokenCount : 0,
      inDeck: unit.level === 'inDeck' ? unit.tokenCount : 0,
      learning: unit.level === 'learning' ? unit.tokenCount : 0,
      known: unit.level === 'known' ? unit.tokenCount : 0,
      wellKnown: unit.level === 'wellKnown' ? unit.tokenCount : 0
    }
  )
}

/** Returns every knowledge identity observed for a unit's occurrences. */
export function vocabularyUnitIdentities(unit: VocabularyUnit): string[] {
  return [...(metadataByUnit.get(unit)?.identities ?? new Set([unit.key, unit.surface]))]
}

interface AcceptedSpan {
  span: VocabularySpan
  members: Token[]
  firstTokenIndex: number
}

interface PreparedCue {
  cue: VocabularyUnitCue
  spans: AcceptedSpan[]
}

function emptyLevelCounts(): UnitLevelCounts {
  return { unknown: 0, inDeck: 0, learning: 0, known: 0, wellKnown: 0 }
}

function acceptedSpans(cue: VocabularyUnitCue): AcceptedSpan[] {
  const tokensByOffset = new Map(cue.tokens.map((token) => [token.startOffset, token]))
  const tokenIndexes = new Map(cue.tokens.map((token, index) => [token.startOffset, index]))
  const candidates: AcceptedSpan[] = []
  const occupiedOffsets = new Set<number>()

  for (const span of cue.spans ?? []) {
    if (span.cueKey !== cue.cueKey || span.memberTokenOffsets.length < 1) continue
    const members = span.memberTokenOffsets
      .map((offset) => tokensByOffset.get(offset))
      .filter((token): token is Token => token !== undefined)
    if (members.length !== span.memberTokenOffsets.length || members.some(isSymbolToken)) continue

    const orderedMembers = members.sort(
      (left, right) => tokenIndexes.get(left.startOffset)! - tokenIndexes.get(right.startOffset)!
    )
    candidates.push({
      span,
      members: orderedMembers,
      firstTokenIndex: tokenIndexes.get(orderedMembers[0].startOffset)!
    })
  }

  return candidates
    .sort((a, b) => a.firstTokenIndex - b.firstTokenIndex)
    .filter((candidate) => {
      if (candidate.members.some((token) => occupiedOffsets.has(token.startOffset))) return false
      for (const member of candidate.members) occupiedOffsets.add(member.startOffset)
      return true
    })
}

function addIdentity(metadata: UnitMetadata, identity: string): void {
  if (identity) metadata.identities.add(identity)
}

function detailLevel(
  details: Record<string, KnowledgeDetails>,
  identities: string[]
): KnowledgeLevel {
  return identities.reduce<KnowledgeLevel>(
    (level, identity) => maxKnowledgeLevel(level, details[identity]?.level ?? 'unknown'),
    'unknown'
  )
}

function spanToken(span: VocabularySpan, member: Token, key: string): Token {
  return { ...member, lemma: key, surface: span.matchedSurface }
}

function createUnit(
  key: string,
  surface: string,
  token: Token,
  cue: VocabularyUnitCue,
  level: KnowledgeLevel,
  grammar: boolean,
  order: number
): VocabularyUnit {
  const unit: VocabularyUnit = {
    key,
    surface,
    token,
    sentence: cue.text ?? '',
    cueStart: cue.start,
    cueEnd: cue.end,
    count: 0,
    tokenCount: 0,
    level,
    grammar,
    order
  }
  metadataByUnit.set(unit, { tokenLevels: emptyLevelCounts(), identities: new Set() })
  return unit
}

/**
 * Derives the vocabulary units used by both the word report and bulk mining.
 * A span is processed once, while its member tokens contribute to tokenCount.
 */
export function deriveVocabularyUnits(
  cues: VocabularyUnitCue[],
  details: Record<string, KnowledgeDetails>
): VocabularyUnit[] {
  const preparedCues: PreparedCue[] = cues.map((cue) => ({ cue, spans: acceptedSpans(cue) }))
  const lemmaExpressions = new Map<string, string>()

  // Build the projection map before aggregating tokens so a bare occurrence can
  // use a projection discovered later in the track.
  for (const { spans } of preparedCues) {
    for (const { span, members } of spans) {
      for (const member of members) {
        if (!lemmaExpressions.has(member.lemma)) lemmaExpressions.set(member.lemma, span.expression)
      }
    }
  }

  const units = new Map<string, VocabularyUnit>()
  let order = 0

  const addOccurrence = (
    key: string,
    surface: string,
    token: Token,
    cue: VocabularyUnitCue,
    occurrenceLevel: KnowledgeLevel,
    grammar: boolean,
    tokenCount: number,
    identities: string[]
  ): void => {
    const occurrenceOrder = order++
    let unit = units.get(key)
    if (!unit) {
      unit = createUnit(key, surface, token, cue, occurrenceLevel, grammar, occurrenceOrder)
      units.set(key, unit)
    }
    unit.count++
    unit.tokenCount += tokenCount
    unit.level = maxKnowledgeLevel(unit.level, occurrenceLevel)
    unit.grammar ||= grammar

    const metadata = metadataByUnit.get(unit)!
    metadata.tokenLevels[occurrenceLevel] += tokenCount
    for (const identity of identities) addIdentity(metadata, identity)
  }

  for (const { cue, spans } of preparedCues) {
    const spanByOffset = new Map<number, AcceptedSpan>()
    for (const accepted of spans) {
      for (const member of accepted.members) spanByOffset.set(member.startOffset, accepted)
    }
    const processedSpans = new Set<AcceptedSpan>()

    for (const token of cue.tokens) {
      if (isSymbolToken(token)) continue

      const accepted = spanByOffset.get(token.startOffset)
      if (accepted) {
        if (processedSpans.has(accepted)) continue
        processedSpans.add(accepted)
        const { span, members } = accepted
        const identities = [
          span.expression,
          span.matchedSurface,
          ...members.flatMap((member) => [member.lemma, member.surface])
        ]
        const occurrenceLevel = maxKnowledgeLevel(span.level, detailLevel(details, identities))
        const key = span.expression
        addOccurrence(
          key,
          span.matchedSurface,
          spanToken(span, members[0], key),
          cue,
          occurrenceLevel,
          members.some(isGrammarToken),
          members.length,
          identities
        )
        continue
      }

      const key = lemmaExpressions.get(token.lemma) ?? token.lemma
      const identities = [token.lemma, token.surface]
      addOccurrence(
        key,
        token.surface,
        token,
        cue,
        detailLevel(details, identities),
        isGrammarToken(token),
        1,
        identities
      )
    }
  }

  return [...units.values()]
}
