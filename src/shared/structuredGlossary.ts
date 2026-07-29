// Safe, renderer-neutral representation of Yomitan structured glossary content.

export type GlossaryNode = string | GlossaryElement

export interface GlossaryElement {
  tag: GlossaryTag
  children: GlossaryNode[]
  style: Record<string, string>
  data: Record<string, string>
  /** A Yomitan popup link target. It is intentionally not serialized as an HTML href. */
  linkQuery?: string
}

export type GlossaryTag =
  | 'br'
  | 'ruby'
  | 'rt'
  | 'rp'
  | 'span'
  | 'div'
  | 'ol'
  | 'ul'
  | 'li'
  | 'details'
  | 'summary'
  | 'table'
  | 'thead'
  | 'tbody'
  | 'tfoot'
  | 'tr'
  | 'td'
  | 'th'
  | 'a'

const TAGS = new Set<GlossaryTag>([
  'br',
  'ruby',
  'rt',
  'rp',
  'span',
  'div',
  'ol',
  'ul',
  'li',
  'details',
  'summary',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'a'
])
const SAFE_STYLE_PROPERTIES = new Set([
  'color',
  'background',
  'backgroundColor',
  'background-color',
  'fontSize',
  'font-size',
  'fontStyle',
  'font-style',
  'fontWeight',
  'font-weight',
  'fontFamily',
  'font-family',
  'textDecoration',
  'text-decoration',
  'textAlign',
  'text-align',
  'verticalAlign',
  'vertical-align',
  'whiteSpace',
  'white-space',
  'display',
  'lineHeight',
  'line-height',
  'margin',
  'marginTop',
  'margin-top',
  'marginRight',
  'margin-right',
  'marginBottom',
  'margin-bottom',
  'marginLeft',
  'margin-left',
  'padding',
  'paddingTop',
  'padding-top',
  'paddingRight',
  'padding-right',
  'paddingBottom',
  'padding-bottom',
  'paddingLeft',
  'padding-left',
  'border',
  'borderColor',
  'border-color',
  'borderStyle',
  'border-style',
  'borderWidth',
  'border-width',
  'borderLeft',
  'border-left',
  'borderRight',
  'border-right',
  'borderTop',
  'border-top',
  'borderBottom',
  'border-bottom',
  'borderRadius',
  'border-radius',
  'boxShadow',
  'box-shadow',
  'listStyleType',
  'list-style-type'
])

function safeStyle(style: unknown): Record<string, string> {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return {}
  const normalized: Record<string, string> = {}
  for (const [property, value] of Object.entries(style)) {
    if (
      !SAFE_STYLE_PROPERTIES.has(property) ||
      (typeof value !== 'string' && typeof value !== 'number')
    )
      continue
    const css = String(value).trim()
    if (css !== '' && !/[;{}]/.test(css) && !/url\s*\(|expression\s*\(|@import/i.test(css))
      normalized[property] = css
  }
  return normalized
}

function safeData(data: unknown): Record<string, string> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(data)) {
    if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(key) && typeof value === 'string') normalized[key] = value
  }
  return normalized
}

export function parseInternalLinkQuery(href: string): string | null {
  const match = /^\?(.*)$/.exec(href)
  const query = match && new URLSearchParams(match[1]).get('query')
  return query && query.length > 0 ? query : null
}

function normalizeNode(value: unknown): GlossaryNode[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(normalizeNode)
  if (!value || typeof value !== 'object') return []
  const raw = value as Record<string, unknown>
  if (typeof raw.tag !== 'string' || raw.tag === 'img') return []
  const tag = TAGS.has(raw.tag as GlossaryTag) ? (raw.tag as GlossaryTag) : 'span'
  const linkQuery =
    tag === 'a' && typeof raw.href === 'string'
      ? (parseInternalLinkQuery(raw.href) ?? undefined)
      : undefined
  return [
    {
      tag,
      children: normalizeNode(raw.content),
      style: safeStyle(raw.style),
      data: safeData(raw.data),
      linkQuery
    }
  ]
}

/** Parses raw Yomitan glossary JSON; malformed or unsupported entries are omitted. */
export function parseStructuredGlossary(
  glossaryJson: string | null | undefined
): GlossaryNode[] | null {
  if (!glossaryJson) return null
  try {
    const parsed: unknown = JSON.parse(glossaryJson)
    if (!Array.isArray(parsed)) return null
    return parsed.flatMap((item) => {
      if (typeof item === 'string') return [item]
      if (!item || typeof item !== 'object') return []
      const entry = item as Record<string, unknown>
      if (entry.type === 'text' && typeof entry.text === 'string') return [entry.text]
      return entry.type === 'structured-content' ? normalizeNode(entry.content) : []
    })
  } catch {
    return null
  }
}

/** Caps the first sibling list made of Yomitan `data.content = sense` nodes. */
export function capGlossarySenses(nodes: GlossaryNode[], maxMeanings: number): GlossaryNode[] {
  if (!Number.isFinite(maxMeanings)) return nodes
  const cap = (items: GlossaryNode[]): GlossaryNode[] => {
    if (items.some((item) => typeof item !== 'string' && item.data.content === 'sense'))
      return items.slice(0, maxMeanings)
    return items.map((item) =>
      typeof item === 'string' ? item : { ...item, children: cap(item.children) }
    )
  }
  return cap(nodes)
}

export function glossaryDataAttributes(data: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      `data-sc-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`,
      value
    ])
  )
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  )
}

function kebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
}

const SAFE_CSS_PROPERTIES = new Set([...SAFE_STYLE_PROPERTIES].map(kebabCase))

/**
 * Keeps only dictionary rules that target structured-content attributes in
 * this glossary. This brings Yomitan's badges, example boxes, tables, and
 * reference cards to Anki without allowing a dictionary stylesheet to affect
 * the rest of an Anki card or load external content.
 */
export function sanitizeGlossaryCss(stylesCss: string | null | undefined): string {
  if (!stylesCss) return ''
  const rules: string[] = []
  const source = stylesCss.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim()
    if (
      !selector
        .split(',')
        .every((branch) =>
          /^(?:[a-z][\w-]*)?\[data-sc-[^\]]+\](?:[\w\s\[\]="'|^$*:_\-.,>#()]+)?$/i.test(
            branch.trim()
          )
        )
    )
      continue
    const declarations: string[] = []
    for (const declaration of match[2].split(';')) {
      const colon = declaration.indexOf(':')
      if (colon === -1) continue
      const property = declaration.slice(0, colon).trim()
      const value = declaration.slice(colon + 1).trim()
      if (
        !(SAFE_CSS_PROPERTIES.has(property) || /^--[a-z][a-z0-9-]*$/i.test(property)) ||
        value === '' ||
        /url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding|[<>]/i.test(value)
      )
        continue
      declarations.push(`${property}:${value}`)
    }
    if (declarations.length > 0) rules.push(`${selector}{${declarations.join(';')}}`)
  }
  return rules.join('')
}

/** Serializes the normalized tree to HTML suitable for an Anki field. */
export function serializeGlossaryHtml(nodes: GlossaryNode[]): string {
  return nodes
    .map((node) => {
      if (typeof node === 'string') return escapeHtml(node)
      const attributes = [
        ...Object.entries(node.style).map(([key, value]) => `${kebabCase(key)}:${value}`),
        ...Object.entries(glossaryDataAttributes(node.data)).map(
          ([key, value]) => `${key}="${escapeHtml(value)}"`
        )
      ]
      const style = attributes.filter((attribute) => !attribute.startsWith('data-')).join(';')
      const data = attributes.filter((attribute) => attribute.startsWith('data-'))
      const attrs = [style && `style="${escapeHtml(style)}"`, ...data].filter(Boolean).join(' ')
      if (node.tag === 'br') return '<br>'
      const content = serializeGlossaryHtml(node.children)
      const tag = node.tag === 'a' ? 'span' : node.tag
      return `<${tag}${attrs ? ` ${attrs}` : ''}>${content}</${tag}>`
    })
    .join('')
}

/** Escapes the legacy flattened glossary so malformed data remains safe and usable. */
export function fallbackGlossaryHtml(glossary: string): string {
  return escapeHtml(glossary).replace(/\n/g, '<br>')
}
