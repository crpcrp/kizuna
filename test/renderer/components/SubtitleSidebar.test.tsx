import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SubtitleSidebar from '@src/renderer/src/components/SubtitleSidebar'
import { cueKey } from '@src/renderer/src/state/tokenization'
import type { Cue } from '@src/shared/cue'
import type { Token } from '@src/shared/token'
import { makeToken } from '@test/harness/tokenFixtures'

const cueA: Cue = { start: 0, end: 2, text: 'hello' }
const cueB: Cue = { start: 3, end: 5, text: 'a\nb' }

describe('SubtitleSidebar empty state', () => {
  it('shows a placeholder when there are no cues', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar cues={[]} tokens={{}} onSelectCue={vi.fn()} />
    )
    expect(html).toContain('id="subtitle-sidebar-empty"')
    expect(html).not.toContain('<ul')
  })
})

describe('SubtitleSidebar row rendering', () => {
  it('renders one row per cue', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar cues={[cueA, cueB]} tokens={{}} onSelectCue={vi.fn()} />
    )
    expect(html).toContain('hello')
    expect(html).toContain('a')
    expect(html).toContain('b')
    expect((html.match(/class="subtitle-sidebar-row"/g) ?? []).length).toBe(2)
  })

  it('falls back to plain line-broken text when a cue has no tokens yet', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar cues={[cueB]} tokens={{}} onSelectCue={vi.fn()} />
    )
    expect(html).toContain('<br/>')
    expect(html).not.toContain('data-level')
  })

  it('marks the active row with data-active, by cueKey', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar
        cues={[cueA, cueB]}
        tokens={{}}
        activeCueKey={cueKey(cueA)}
        onSelectCue={vi.fn()}
      />
    )
    expect(html).toContain(
      'class="subtitle-sidebar-row" data-active=""><span class="interactive-text" data-interactive-text-id="0|2|hello"><span>hello'
    )
  })

  it('marks no row active when activeCueKey matches none of the cues', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar cues={[cueA, cueB]} tokens={{}} activeCueKey="nope" onSelectCue={vi.fn()} />
    )
    expect(html).not.toContain('data-active')
  })
})

describe('SubtitleSidebar knowledge-level coloring', () => {
  const cue: Cue = { start: 0, end: 2, text: '猫は可愛い' }
  const tokens: Token[] = [
    makeToken({ surface: '猫' }),
    makeToken({ surface: 'は', startOffset: 1 }),
    makeToken({ surface: '可愛い', startOffset: 2 })
  ]

  it('renders data-level per token when tokens are available for the cue', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar
        cues={[cue]}
        tokens={{ [cueKey(cue)]: tokens }}
        levels={{ 猫: 'learning', は: 'wellKnown', 可愛い: 'known' }}
        onSelectCue={vi.fn()}
      />
    )
    expect(html).toContain('data-level="learning">猫</span>')
    expect(html).toContain('data-level="wellKnown">は</span>')
    expect(html).toContain('data-level="known">可愛い</span>')
  })
})

describe('SubtitleSidebar search controls', () => {
  it('always shows the search field and its Search button by default', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar cues={[]} tokens={{}} onSelectCue={vi.fn()} />
    )
    expect(html).toContain('aria-label="Search query"')
    expect(html).toContain('aria-label="Search subtitles"')
    expect(html).toContain('>Search</button>')
    expect(html).not.toContain('aria-label="Clear search"')
  })
})
