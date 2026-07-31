import { parseStructuredGlossary, type GlossaryNode } from '../../../shared/structuredGlossary'
import type { LookupResult } from '../../../shared/dictionary'
import type { LookupDb } from './lookupDb'
import { normalizeReading } from './reading'

export interface CrossReferenceTarget {
  query: string
  reading: string | null
}

interface CollectedLink {
  query: string
  reading: string
}

// Keep the markers as escapes: Jitendex emits U+27F6 (long rightwards arrow),
// whereas older fixtures covered only U+27B6 (long rightwards squiggle arrow).
const CROSS_REFERENCE_RESIDUAL =
  /^[\s\u2192\u27B6\u27F6\u21D2\u21D8\u21E8\u27A1\u261E\uFF1D=:\uFF1A;\uFF1B\u3001\u3002\u30FB\uFF61()\uFF08\uFF09\u2014\u2015\u3010\u3011\[\]\u300C\u300D\u300E\u300F]*$/u

/**
 * Returns the internal-link target when a structured glossary contains only a
 * cross-reference marker and that link. Ordinary definitions that mention a
 * linked word are deliberately left alone.
 */
export function extractSoleCrossReference(
  glossaryJson: string | null | undefined
): CrossReferenceTarget | null {
  if (!glossaryJson || !glossaryJson.includes('?query=')) return null

  const nodes = parseStructuredGlossary(glossaryJson)
  if (!nodes || nodes.length === 0) return null

  const links: CollectedLink[] = []
  let residualText = ''

  const walk = (
    node: GlossaryNode,
    insideTargetLink: boolean,
    insideRt: boolean,
    currentLink?: CollectedLink
  ): void => {
    if (typeof node === 'string') {
      if (insideRt && currentLink) currentLink.reading += node
      else if (!insideTargetLink && !insideRt) residualText += node
      return
    }

    let link = currentLink
    if (node.tag === 'a' && node.linkQuery) {
      link = { query: node.linkQuery, reading: '' }
      links.push(link)
    }

    const nextInsideTargetLink =
      insideTargetLink || (node.tag === 'a' && node.linkQuery !== undefined)
    const nextInsideRt = insideRt || node.tag === 'rt' || node.tag === 'rp'
    for (const child of node.children) walk(child, nextInsideTargetLink, nextInsideRt, link)
  }

  for (const node of nodes) walk(node, false, false)

  if (links.length !== 1 || !CROSS_REFERENCE_RESIDUAL.test(residualText)) return null
  return { query: links[0].query, reading: links[0].reading || null }
}

function rawContents(glossaryJson: string | null | undefined, glossary: string): unknown[] {
  if (glossaryJson) {
    try {
      const parsed: unknown = JSON.parse(glossaryJson)
      if (Array.isArray(parsed)) {
        return parsed.flatMap((item): unknown[] => {
          if (typeof item === 'string') return [item]
          if (!item || typeof item !== 'object') return []
          const entry = item as Record<string, unknown>
          if (entry.type === 'text' && typeof entry.text === 'string') return [entry.text]
          return entry.type === 'structured-content' ? [entry.content] : []
        })
      }
    } catch {
      // Legacy rows can contain malformed JSON; preserve their text below.
    }
  }

  return glossary
    .split('\n')
    .flatMap((line, index) => (index === 0 ? [line] : [{ tag: 'br' }, line]))
}

/**
 * Keeps a redirect's clickable source line and adds its resolved definition in
 * one top-level structured-content item, so popup meaning limits cannot hide
 * the definition as a later sibling.
 */
export function mergeCrossReferenceGlossary(
  source: Pick<LookupResult, 'glossary' | 'glossaryJson'>,
  target: Pick<LookupResult, 'glossary' | 'glossaryJson'>
): { glossary: string; glossaryJson: string } {
  const content = [
    {
      type: 'structured-content',
      content: {
        tag: 'div',
        data: { content: 'kizuna-xref' },
        content: [
          {
            tag: 'div',
            data: { content: 'kizuna-xref-source' },
            content: rawContents(source.glossaryJson, source.glossary)
          },
          {
            tag: 'div',
            data: { content: 'kizuna-xref-target' },
            content: rawContents(target.glossaryJson, target.glossary)
          }
        ]
      }
    }
  ]

  return {
    glossary: `${source.glossary}\n${target.glossary}`,
    glossaryJson: JSON.stringify(content)
  }
}

interface CrossReferenceRow {
  expression: string
  reading: string | null
  glossary: string
  glossary_json: string | null
}

const SELECT_CROSS_REFERENCE_BY_EXPRESSION = `
SELECT expression, reading, glossary, glossary_json
FROM terms
WHERE dict_id = ? AND expression = ?
ORDER BY score DESC, id ASC
`

const SELECT_CROSS_REFERENCE_BY_READING = `
SELECT expression, reading, glossary, glossary_json
FROM terms
WHERE dict_id = ? AND reading = ?
ORDER BY score DESC, id ASC
`

function selectCrossReferenceRow(
  expressionStatement: ReturnType<LookupDb['prepare']>,
  readingStatement: ReturnType<LookupDb['prepare']>,
  dictId: number,
  target: CrossReferenceTarget
): CrossReferenceRow | null {
  let rows = expressionStatement.all(dictId, target.query) as CrossReferenceRow[]
  if (rows.length === 0) {
    rows = readingStatement.all(dictId, target.query) as CrossReferenceRow[]
  }

  if (target.reading) {
    const normalizedReading = normalizeReading(target.reading)
    return (
      rows.find((row) => normalizeReading(row.reading ?? '') === normalizedReading) ??
      rows[0] ??
      null
    )
  }
  return rows[0] ?? null
}

/**
 * Resolves same-dictionary redirect-only entries without changing lookup rank
 * or metadata. A missing target, a redirect cycle, or a chain longer than
 * three hops leaves the original result intact.
 */
export function resolveCrossReferences(db: LookupDb, results: LookupResult[]): LookupResult[] {
  const expressionStatement = db.prepare(SELECT_CROSS_REFERENCE_BY_EXPRESSION)
  const readingStatement = db.prepare(SELECT_CROSS_REFERENCE_BY_READING)

  return results.map((result) => {
    let target = extractSoleCrossReference(result.glossaryJson)
    if (!target) return result

    const visited = new Set([result.expression])
    for (let depth = 0; depth < 3; depth += 1) {
      const row = selectCrossReferenceRow(
        expressionStatement,
        readingStatement,
        result.dictId,
        target
      )
      if (!row || visited.has(row.expression)) return result

      const nextTarget = extractSoleCrossReference(row.glossary_json)
      if (!nextTarget) {
        return {
          ...result,
          ...mergeCrossReferenceGlossary(result, {
            glossary: row.glossary,
            glossaryJson: row.glossary_json
          }),
          audioExpression: row.expression,
          audioReading: row.reading ?? undefined
        }
      }
      if (depth === 2) return result

      visited.add(row.expression)
      target = nextTarget
    }

    return result
  })
}
