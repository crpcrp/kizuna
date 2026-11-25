/** Structural subset of better-sqlite3's `Database` this module needs. */
export interface VariantsDb {
  prepare(sql: string): { all(...params: unknown[]): unknown[] }
}

const LEMMA_CHUNK_SIZE = 500

/**
 * Maps each lemma to the other spellings of its dictionary entry (e.g. お主 →
 * 御主), joined by a shared sequence number and reading. A lemma that belongs to
 * several entries of one dictionary (e.g. kana かける) is ambiguous there and
 * gets no variants from it.
 */
export function spellingVariants(db: VariantsDb, lemmas: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  const unique = [...new Set(lemmas)]
  for (let i = 0; i < unique.length; i += LEMMA_CHUNK_SIZE) {
    const batch = unique.slice(i, i + LEMMA_CHUNK_SIZE)
    const rows = db
      .prepare(
        `SELECT DISTINCT t.expression AS lemma, t.dict_id AS dictId, t.sequence AS sequence,
                v.expression AS variant
         FROM terms t
         JOIN dictionaries d ON d.id = t.dict_id AND d.enabled = 1
         JOIN terms v ON v.reading = t.reading AND v.dict_id = t.dict_id AND v.sequence = t.sequence
         WHERE t.expression IN (${batch.map(() => '?').join(', ')}) AND t.sequence > 0`
      )
      .all(...batch) as Array<{ lemma: string; dictId: number; sequence: number; variant: string }>

    const sequences = new Map<string, Set<number>>()
    for (const row of rows) {
      const key = `${row.lemma}\u0000${row.dictId}`
      sequences.set(key, (sequences.get(key) ?? new Set()).add(row.sequence))
    }
    for (const row of rows) {
      if (row.variant === row.lemma) continue
      if (sequences.get(`${row.lemma}\u0000${row.dictId}`)!.size > 1) continue
      const variants = (result[row.lemma] ??= [])
      if (!variants.includes(row.variant)) variants.push(row.variant)
    }
  }
  return result
}
