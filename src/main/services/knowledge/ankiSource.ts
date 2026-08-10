// Reads every card in a configured deck and full-replaces the 'anki' source in
// the knowledge DB. Shape mirrors
// wanikani/sync.ts's syncWaniKani (client + db + now -> { count, syncedAt }),
// but pulls from AnkiConnect's findCards/cardsInfo instead of WaniKani's
// paginated API.

import type { AnkiCardInfo, AnkiClient } from '../anki/ankiConnect'
import type { KnowledgeDb, KnownRow } from './store'
import { replaceSource, setSyncState } from './store'
import type { IntervalThresholds } from './levels'
import { levelFromAnkiCard, mergeLevel } from './levels'
import type { AnkiSourceDetail } from '../../../shared/knowledge'

/** cardsInfo request-size chunk — matches wanikani/sync.ts's chunking idiom. */
const CARDS_INFO_CHUNK_SIZE = 500

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/** Quotes one literal deck name for Anki's `deck:"..."` search syntax. */
function deckSearchTerm(deckName: string): string {
  return `deck:"${deckName.replace(/[\\"*_]/g, '\\$&')}"`
}

/**
 * Reduces an Anki field's raw HTML down to its bare headword: Anki fields
 * routinely carry `食[た]べる` furigana syntax, `<ruby>`/`<rt>`/`<rp>` markup,
 * `<div>`/`<br>` wrappers, and `&nbsp;`. A word that fails to normalize
 * silently never colors (an invisible bug), so this strips broadly rather
 * than trying to whitelist every input shape.
 */
export function normalizeAnkiField(html: string): string {
  let normalized = html
  let previous: string
  // Removing an outer tag can expose another tag, so repeat until stable.
  do {
    previous = normalized
    normalized = normalized
      .replace(/<rt>[^<]*<\/rt>/gi, '')
      .replace(/<rp>[^<]*<\/rp>/gi, '')
      .replace(/<\/?ruby>/gi, '')
      .replace(/ ?([^ >]+?)\[(.+?)\]/g, '$1') // Anki's kanji filter: drops the separator space
      .replace(/\[[^\]]*\]/g, '')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/<\/?div[^>]*>/gi, '')
      .replace(/<[^>]+>/g, '')
  } while (normalized !== previous)

  return normalized.replace(/&nbsp;/gi, '').trim()
}

/**
 * Pulls every card in any of `deckNames` (OR'd together in one `findCards`
 * query), stores new/buried cards as 'inDeck' rows and suspended cards as
 * 'wellKnown' (see `levelFromAnkiCard`) rather than dropping them, normalizes
 * each card's `wordField` to a bare lemma, and full-replaces the 'anki' source. The
 * row count therefore covers every card in the selected decks, learned or not.
 * A word mined into more than one
 * selected deck collapses to a single row keyed by `lemma+reading`, folding
 * the colliding levels with `mergeLevel` (higher rank wins) while retaining
 * every card's provenance — otherwise it would violate `replaceSource`'s
 * `(source, lemma, reading)` primary key.
 * With no selected decks it purges prior Anki rows without contacting Anki;
 * the source is unconfigured, not in error.
 */
export async function syncAnki(deps: {
  client: AnkiClient
  db: KnowledgeDb
  deckNames: string[]
  wordField: string
  thresholds: IntervalThresholds
  now: () => number
}): Promise<{ count: number; syncedAt: string }> {
  const { client, db, deckNames, wordField, thresholds, now } = deps
  const syncedAt = new Date(now()).toISOString()

  if (deckNames.length === 0) {
    const count = replaceSource(db, 'anki', [], syncedAt)
    setSyncState(db, 'anki', syncedAt)
    return { count, syncedAt }
  }

  const selectedDecks = new Set(deckNames)
  const query = deckNames.map(deckSearchTerm).join(' OR ')
  const ids = await client.findCards(query)
  // AnkiConnect serves requests from Anki's UI process. A large deck can span
  // many chunks; issuing every cardsInfo request at once can exhaust its local
  // HTTP server even though a lightweight version ping succeeds. Keep the
  // requests serial so the import remains reliable for large collections.
  const cards: AnkiCardInfo[] = []
  for (const idsChunk of chunk(ids, CARDS_INFO_CHUNK_SIZE)) {
    cards.push(...(await client.cardsInfo(idsChunk)))
  }

  const byKey = new Map<string, KnownRow>()
  for (const card of cards) {
    if (!selectedDecks.has(card.deckName)) continue
    const level = levelFromAnkiCard(card, thresholds)
    // Defensive only: `levelFromAnkiCard` no longer returns 'unknown' for a real
    // card, but the type still permits it and an 'unknown' row is meaningless.
    if (level === 'unknown') continue
    const lemma = normalizeAnkiField(card.fields[wordField]?.value ?? '')
    if (lemma === '') continue
    const reading = ''
    const key = `${lemma}\u0000${reading}`
    const existing = byKey.get(key)
    const detail: AnkiSourceDetail = {
      source: 'anki',
      deck: card.deckName,
      intervalDays: card.interval,
      cardId: card.cardId,
      noteId: card.note
    }
    byKey.set(
      key,
      existing
        ? {
            ...existing,
            level: mergeLevel(existing.level, level),
            metadata: [
              ...(Array.isArray(existing.metadata) ? existing.metadata : [existing.metadata!]),
              detail
            ]
          }
        : { source: 'anki', lemma, reading, level, metadata: detail }
    )
  }
  const rows = [...byKey.values()]

  const count = replaceSource(db, 'anki', rows, syncedAt)
  setSyncState(db, 'anki', syncedAt)
  return { count, syncedAt }
}
