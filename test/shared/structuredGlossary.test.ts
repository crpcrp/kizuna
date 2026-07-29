import { describe, expect, it } from 'vitest'
import {
  fallbackGlossaryHtml,
  parseStructuredGlossary,
  sanitizeGlossaryCss,
  serializeGlossaryHtml
} from '@src/shared/structuredGlossary'

describe('structured glossary', () => {
  it('normalizes rich content and serializes safe equivalent Anki HTML', () => {
    const nodes = parseStructuredGlossary(
      JSON.stringify([
        {
          type: 'structured-content',
          content: {
            tag: 'div',
            style: { color: 'red', backgroundImage: 'url(evil)' },
            data: { content: 'example-sentence', 'x" onmouseover="alert(1)': 'bad' },
            content: [
              { tag: 'ruby', content: ['漢', { tag: 'rt', content: 'かん' }] },
              { tag: 'a', href: '?query=語', onclick: 'evil()', content: 'related' },
              { tag: 'script', content: 'bad' }
            ]
          }
        }
      ])
    )

    expect(nodes).not.toBeNull()
    expect(serializeGlossaryHtml(nodes!)).toBe(
      '<div style="color:red" data-sc-content="example-sentence"><ruby>漢<rt>かん</rt></ruby><span>related</span><span>bad</span></div>'
    )
  })

  it('rejects malformed input and escapes the legacy glossary fallback', () => {
    expect(parseStructuredGlossary('{bad')).toBeNull()
    expect(fallbackGlossaryHtml('<unsafe>\n&')).toBe('&lt;unsafe&gt;<br>&amp;')
  })

  it('preserves Yomitan CSS-style properties used by rich cards', () => {
    const nodes = parseStructuredGlossary(
      JSON.stringify([
        {
          type: 'structured-content',
          content: {
            tag: 'div',
            style: {
              'background-color': 'color-mix(in srgb, var(--text-color) 5%, transparent)',
              'border-left': '3px solid var(--text-color)',
              'border-radius': '0.4rem',
              'margin-top': '0.5rem',
              padding: '0.5rem'
            },
            content: 'example'
          }
        }
      ])
    )

    expect(serializeGlossaryHtml(nodes!)).toBe(
      '<div style="background-color:color-mix(in srgb, var(--text-color) 5%, transparent);border-left:3px solid var(--text-color);border-radius:0.4rem;margin-top:0.5rem;padding:0.5rem">example</div>'
    )
  })

  it('retains safe semantic stylesheet rules and drops global or unsafe ones', () => {
    expect(
      sanitizeGlossaryCss(`
      div[data-sc-content="example-sentence"] { background-color: #f5f5f5; border-left: 3px solid #111; padding: 0.5rem; }
      [data-sc-content="tag"] { color: white; background: #555; border-radius: 0.25rem; }
      body { color: red; }
      body, [data-sc-content="also-bad"] { color: red; }
      [data-sc-content="sibling-escape"] ~ * { color: red; }
      [data-sc-content="bad"] { background: url(https://evil.example/x); color: red; }
    `)
    ).toBe(
      'div[data-sc-content="example-sentence"]{background-color:#f5f5f5;border-left:3px solid #111;padding:0.5rem}[data-sc-content="tag"]{color:white;background:#555;border-radius:0.25rem}[data-sc-content="bad"]{color:red}'
    )
  })
})
