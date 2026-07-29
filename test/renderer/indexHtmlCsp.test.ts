import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '@test/paths'

// Guards the renderer Content-Security-Policy (red-team review I2). The policy
// lives in a <meta> tag in index.html, so nothing in tsc or a component test
// notices if a directive is dropped or if 'unsafe-inline' leaks into scripts.

const INDEX_HTML = join(REPO_ROOT, 'src', 'renderer', 'index.html')

/**
 * Extracts the `content` of the CSP <meta http-equiv> from an HTML document,
 * as a directive-name → source-list map. Returns {} when no such meta exists
 * (which the tests below treat as a failure).
 */
export function parseCspMeta(html: string): Record<string, string> {
  const meta = html.match(/<meta\s+[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i)?.[0]
  // The value itself contains single quotes ('self', 'none'), so match on the
  // opening quote character and close on the same one.
  const content = meta?.match(/content=(["'])(.*?)\1/is)?.[2]
  if (!content) return {}

  const directives: Record<string, string> = {}
  for (const part of content.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/)
    if (name) directives[name.toLowerCase()] = sources.join(' ')
  }
  return directives
}

describe('parseCspMeta', () => {
  it('splits the policy into directives', () => {
    const csp = parseCspMeta(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; object-src 'none'" />`
    )

    expect(csp).toEqual({ 'default-src': "'self'", 'object-src': "'none'" })
  })

  it('returns {} when the document carries no CSP meta', () => {
    expect(parseCspMeta('<meta charset="UTF-8" />')).toEqual({})
  })
})

describe('renderer CSP', () => {
  const csp = parseCspMeta(readFileSync(INDEX_HTML, 'utf-8'))

  it('restricts every default source to the bundled origin', () => {
    expect(csp['default-src']).toBe("'self'")
  })

  it('keeps the inline-style allowance scoped to styles only', () => {
    // React inline styles and the per-dictionary <style> blocks need this;
    // scripts must never get it (they fall back to default-src 'self').
    expect(csp['style-src']).toBe("'self' 'unsafe-inline'")
    expect(csp['script-src'] ?? '').not.toContain('unsafe-inline')
    expect(csp['default-src']).not.toContain('unsafe-inline')
  })

  it('allows the data: seekbar thumbnails without widening default-src', () => {
    // mediaService.getThumbnail returns `data:image/jpeg;base64,…`, which
    // SeekPreview sets as an <img src>. Without an explicit img-src these fall
    // back to default-src 'self' and Chromium blocks every preview.
    expect(csp['img-src']).toBe("'self' data:")
    expect(csp['default-src']).not.toContain('data:')
  })

  it('locks down plugins, <base>, and form submission', () => {
    expect(csp['object-src']).toBe("'none'")
    expect(csp['base-uri']).toBe("'none'")
    expect(csp['form-action']).toBe("'none'")
  })

  it('omits directives a <meta>-delivered policy cannot enforce', () => {
    // frame-ancestors/sandbox/report-uri are ignored in <meta> and only emit a
    // console warning; the document is always the top-level Electron frame.
    expect(csp).not.toHaveProperty('frame-ancestors')
    expect(csp).not.toHaveProperty('sandbox')
  })
})
