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

/** Resolves one identity — dictionary expression, lemma, or surface — to its level. */
type KnowledgeLevelLookup = (identity: string) => KnowledgeLevel

/** One vocabulary occurrence: an accepted span's members, or a single token. */
interface VocabularyOccurrence {
  key: string
  surface: string
  token: Token
  /** Non-symbol tokens the occurrence covers, in cue order. */
  members: Token[]
  level: KnowledgeLevel
  grammar: boolean
  identities: string[]
}

/**
 * The one word-understanding rule: a grammatical function word is never
 * vocabulary to learn and counts as wellKnown, while every other occurrence
 * takes the best level any of its identities resolves to — starting from the
 * level of the span covering it, when one does.
 */
function occurrenceLevel(
  identities: string[],
  grammar: boolean,
  levelOf: KnowledgeLevelLookup,
  spanLevel: KnowledgeLevel = 'unknown'
): KnowledgeLevel {
  if (grammar) return 'wellKnown'
  return identities.reduce<KnowledgeLevel>(
    (level, identity) => maxKnowledgeLevel(level, levelOf(identity)),
    spanLevel
  )
}

/**
 * Walks one cue's vocabulary occurrences: each accepted span once, covering its
 * members, then every token no span covers. The single place a word occurrence
 * is identified and levelled, shared by every consumer below.
 */
function cueOccurrences(
  { cue, spans }: PreparedCue,
  levelOf: KnowledgeLevelLookup,
  lemmaExpressions: Map<string, string>
): VocabularyOccurrence[] {
  const spanByOffset = new Map<number, AcceptedSpan>()
  for (const accepted of spans) {
    for (const member of accepted.members) spanByOffset.set(member.startOffset, accepted)
  }
  const processedSpans = new Set<AcceptedSpan>()
  const occurrences: VocabularyOccurrence[] = []

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
      const grammar = members.some(isGrammarToken)
      occurrences.push({
        key: span.expression,
        surface: span.matchedSurface,
        token: spanToken(span, members[0], span.expression),
        members,
        level: occurrenceLevel(identities, grammar, levelOf, span.level),
        grammar,
        identities
      })
      continue
    }

    const identities = [token.lemma, token.surface]
    const grammar = isGrammarToken(token)
    occurrences.push({
      key: lemmaExpressions.get(token.lemma) ?? token.lemma,
      surface: token.surface,
      token,
      members: [token],
      level: occurrenceLevel(identities, grammar, levelOf),
      grammar,
      identities
    })
  }

  return occurrences
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
  // use a projection discovered later in the track. Only a single-token
  // projection (ヤツ resolved as 奴) speaks for the token's lemma: a compound's
  // member is not the compound, so a standalone 様 must stay its own word
  // rather than being filed under — and counted as known through — 神様.
  for (const { spans } of preparedCues) {
    for (const { span, members } of spans) {
      if (members.length !== 1) continue
      const [member] = members
      if (!lemmaExpressions.has(member.lemma)) lemmaExpressions.set(member.lemma, span.expression)
    }
  }

  const levelOf: KnowledgeLevelLookup = (identity) => details[identity]?.level ?? 'unknown'
  const units = new Map<string, VocabularyUnit>()
  let order = 0

  for (const prepared of preparedCues) {
    for (const occurrence of cueOccurrences(prepared, levelOf, lemmaExpressions)) {
      const occurrenceOrder = order++
      let unit = units.get(occurrence.key)
      if (!unit) {
        unit = createUnit(
          occurrence.key,
          occurrence.surface,
          occurrence.token,
          prepared.cue,
          occurrence.level,
          occurrence.grammar,
          occurrenceOrder
        )
        units.set(occurrence.key, unit)
      }
      unit.count++
      unit.tokenCount += occurrence.members.length
      unit.level = maxKnowledgeLevel(unit.level, occurrence.level)
      unit.grammar ||= occurrence.grammar

      const metadata = metadataByUnit.get(unit)!
      metadata.tokenLevels[occurrence.level] += occurrence.members.length
      for (const identity of occurrence.identities) {
        if (identity) metadata.identities.add(identity)
      }
    }
  }

  return [...units.values()]
}

/**
 * Per-token knowledge levels for one cue's rendered tokens, resolved through
 * the same span acceptance and occurrence rules as `deriveVocabularyUnits`, so
 * subtitle underlining never disagrees with the word report or bulk mining.
 * Symbol tokens carry no vocabulary and stay out of the map. `levels` is the
 * renderer's lemma cache; an identity it does not know resolves to 'unknown'.
 */
export function vocabularyLevelsByToken(
  cue: VocabularyUnitCue,
  levels: Record<string, KnowledgeLevel>
): Map<number, KnowledgeLevel> {
  const byOffset = new Map<number, KnowledgeLevel>()
  const occurrences = cueOccurrences(
    { cue, spans: acceptedSpans(cue) },
    (identity) => levels[identity] ?? 'unknown',
    new Map()
  )
  for (const occurrence of occurrences) {
    for (const member of occurrence.members) byOffset.set(member.startOffset, occurrence.level)
  }
  return byOffset
}
