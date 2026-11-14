import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AnkiTab, {
  isLoopbackAnkiUrl,
  parseTagsInput
} from '@src/renderer/src/components/options/AnkiTab'
import { makeAnkiSettings } from '@test/harness/ankiFixtures'

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing
// policy — same pattern OptionsMenu.test.tsx uses.

function noop(): void {}

function renderTab(overrides: Partial<React.ComponentProps<typeof AnkiTab>> = {}): string {
  return renderToStaticMarkup(
    <AnkiTab
      ankiSettings={makeAnkiSettings()}
      ankiDeckNames={[]}
      ankiModelNames={[]}
      ankiModelFields={[]}
      ankiPing={async () => ({ ok: false })}
      onSetupJlptField={async () => ({ status: 'already-configured', modelName: 'Kizuna' })}
      onPreviewJlptBackfill={async () => ({
        status: 'preflight-failure',
        modelName: 'Kizuna',
        message: 'Not configured'
      })}
      onApplyJlptBackfill={async () => ({ updated: 0, skipped: 0, failed: 0 })}
      onJlptBackfillProgress={() => () => undefined}
      onChangeAnkiSettings={noop}
      {...overrides}
    />
  )
}

describe('AnkiTab markup', () => {
  it('renders the Anki tab with URL/deck/model inputs bound to ankiSettings', () => {
    const html = renderTab({
      ankiSettings: makeAnkiSettings({ url: 'http://127.0.0.1:8765', deckName: 'Mining' }),
      ankiDeckNames: ['Mining', 'Core 2k'],
      ankiModelNames: ['Basic', 'Kizuna']
    })
    expect(html).toMatch(/id="anki-url-input"[^>]*value="http:\/\/127\.0\.0\.1:8765"/)
    expect(html).toMatch(/<option value="Mining"[^>]*>Mining<\/option>/)
    expect(html).toMatch(/<option value="Core 2k"[^>]*>Core 2k<\/option>/)
    expect(html).toMatch(/<option value="Basic"[^>]*>Basic<\/option>/)
    expect(html).toMatch(/<option value="Kizuna"[^>]*>Kizuna<\/option>/)
  })

  it('renders the API key as a password draft field with Save/Clear, never echoing the stored key', () => {
    const html = renderTab({ ankiSettings: makeAnkiSettings({ apiKey: 'secret' }) })
    // Secret credential (mirrors the WaniKani token): the input is a local draft,
    // so the stored key is never rendered into value; a masked placeholder + a
    // "Configured ✓" status convey that one is set.
    expect(html).toMatch(/type="password"[^>]*id="anki-api-key-input"/)
    expect(html).not.toContain('secret')
    expect(html).toMatch(/id="anki-api-key-input"[^>]*value=""/)
    expect(html).toMatch(/id="anki-api-key-status"[^>]*data-configured="true"[^>]*>Configured ✓/)
    expect(html).toContain('id="anki-api-key-save"')
    expect(html).toContain('id="anki-api-key-clear"')
  })

  it('renders the explicit JLPT setup action beside the note type', () => {
    const html = renderTab({ ankiSettings: makeAnkiSettings({ modelName: 'Kaishi 1.5k' }) })

    expect(html).toContain('id="anki-setup-jlpt-field"')
    expect(html).toContain('>Set up JLPT field</button>')
  })

  it('shows the API key as not set with the Clear button disabled when no key is stored', () => {
    const html = renderTab({ ankiSettings: makeAnkiSettings({ apiKey: '' }) })
    expect(html).toMatch(/id="anki-api-key-status"[^>]*data-configured="false"[^>]*>Not set/)
    expect(html).toMatch(/id="anki-api-key-clear"[^>]*disabled/)
  })

  it('populates each field-mapping select from an injected ankiModelFields prop', () => {
    const html = renderTab({ ankiModelFields: ['Front', 'Back'] })
    expect(html).toContain('id="anki-field-word-select"')
    expect(html).toContain('id="anki-field-reading-select"')
    expect(html).toContain('id="anki-field-definition-select"')
    expect(html).toContain('id="anki-field-sentence-select"')
    expect(html).toContain('id="anki-field-wordAudio-select"')
    expect(html).toContain('id="anki-field-picture-select"')
    expect(html).toContain('id="anki-field-sentenceAudio-select"')
    expect(html).toContain('id="anki-field-frequency-select"')
    expect(html).toContain('id="anki-field-pitchAccent-select"')
    expect(html).toContain('id="anki-field-jlptLevel-select"')
    const frontOptions = html.match(/<option value="Front">Front<\/option>/g) ?? []
    expect(frontOptions).toHaveLength(10)
  })

  it('renders the tags input joined by ", " and the include-audio checkbox', () => {
    const html = renderTab({ ankiSettings: makeAnkiSettings({ tags: ['kizuna', 'jp'] }) })
    expect(html).toMatch(/id="anki-tags-input"[^>]*value="kizuna, jp"/)
    expect(html).toContain('id="anki-include-audio-checkbox"')
  })

  it('renders all duplicate-policy choices with the persisted selection', () => {
    const html = renderTab({
      ankiSettings: makeAnkiSettings({ duplicatePolicy: 'overwrite' })
    })
    expect(html).toMatch(/id="anki-duplicate-policy-select"[^>]*>/)
    expect(html).toContain('<option value="prevent-global">Prevent duplicates globally</option>')
    expect(html).toContain(
      '<option value="prevent-deck">Prevent duplicates in selected deck</option>'
    )
    expect(html).toContain('<option value="overwrite" selected="">Overwrite existing note</option>')
    expect(html).toContain('<option value="allow">Allow duplicates</option>')
  })

  it('shows the load error when set, and renders no error markup when omitted', () => {
    expect(renderTab({ loadError: 'Is Anki running?' })).toMatch(
      /id="anki-load-error"[^>]*>Is Anki running\?/
    )
    expect(renderTab()).not.toContain('options-error')
  })
})

describe('AnkiTab pure helpers', () => {
  it('parseTagsInput splits on commas, trims, and drops empties', () => {
    expect(parseTagsInput('kizuna, jp,  , anime')).toEqual(['kizuna', 'jp', 'anime'])
    expect(parseTagsInput('')).toEqual([])
    expect(parseTagsInput('solo')).toEqual(['solo'])
  })

  it('isLoopbackAnkiUrl accepts only hosts on this machine', () => {
    expect(isLoopbackAnkiUrl('http://127.0.0.1:8765')).toBe(true)
    expect(isLoopbackAnkiUrl('http://localhost:8765')).toBe(true)
    expect(isLoopbackAnkiUrl('http://127.1.2.3:8765')).toBe(true)
    expect(isLoopbackAnkiUrl('http://[::1]:8765')).toBe(true)
    // Not configured yet — nothing to warn about.
    expect(isLoopbackAnkiUrl('')).toBe(true)

    expect(isLoopbackAnkiUrl('http://192.168.1.20:8765')).toBe(false)
    expect(isLoopbackAnkiUrl('http://anki.example.com:8765')).toBe(false)
    // Deceptive host that merely *starts* with a loopback-looking label.
    expect(isLoopbackAnkiUrl('http://localhost.evil.example:8765')).toBe(false)
    // Unparseable errs toward warning.
    expect(isLoopbackAnkiUrl('127.0.0.1:8765')).toBe(false)
  })

  it('warns that mined content leaves the machine only for a non-loopback URL', () => {
    const remote = renderTab({
      ankiSettings: makeAnkiSettings({ url: 'http://192.168.1.20:8765' })
    })
    expect(remote).toContain('id="anki-url-warning"')
    expect(remote).toContain('not on this machine')

    const local = renderTab({
      ankiSettings: makeAnkiSettings({ url: 'http://127.0.0.1:8765' })
    })
    expect(local).not.toContain('anki-url-warning')
  })
})

describe('AnkiTab setting descriptions', () => {
  it('describes the connection URL, target deck and note type', () => {
    const html = renderTab()
    expect(html).toContain(
      'Where the AnkiConnect add-on listens. Anki must be running for mining to work.'
    )
    expect(html).toContain('Mined notes are added to this deck.')
    expect(html).toContain('The note type mined cards use; its fields fill the mapping below.')
  })

  it('discloses local API-key storage and JapanesePod101 requests', () => {
    const html = renderTab()
    expect(html).toContain('id="anki-api-key-storage-hint"')
    expect(html).toContain('stored unencrypted in Kizuna')
    expect(html).toContain('id="jpod101-network-disclosure"')
    expect(html).toContain('word and reading in the request URL')
  })
})

describe.each([
  ['picture', 'Picture', 'Screenshot'],
  ['frequency', 'Frequency', 'Freq'],
  ['pitchAccent', 'Pitch accent', 'Pitch'],
  ['sentenceAudio', 'Sentence audio', 'SentenceAudio'],
  ['jlptLevel', 'JLPT level (approx.)', 'JLPT']
] as const)('AnkiTab %s mapping', (field, label, target) => {
  it('renders its label and binds the selected model field', () => {
    const html = renderTab({
      ankiSettings: makeAnkiSettings({ fieldMap: { [field]: target } }),
      ankiModelFields: [target]
    })
    expect(html).toContain(`>${label}</label>`)
    expect(html).toMatch(
      new RegExp(`id="anki-field-${field}-select"[\\s\\S]*?<option value="${target}" selected`)
    )
  })

  it('shows an unset mapping when the setting is empty', () => {
    const html = renderTab({ ankiSettings: makeAnkiSettings({ fieldMap: { [field]: '' } }) })
    expect(html).toMatch(
      new RegExp(`id="anki-field-${field}-select"[\\s\\S]*?<option value="" selected`)
    )
  })
})

it('explains that mapping media fields enables capture without separate opt-in toggles', () => {
  const html = renderTab()
  expect(html).toContain('id="anki-media-mapping-hint"')
  for (const field of ['screenshot', 'frequency', 'pitch', 'sentence-audio']) {
    expect(html).not.toContain(`anki-include-${field}-checkbox`)
  }
})
