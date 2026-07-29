import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AnkiTab, {
  isLoopbackAnkiUrl,
  parseTagsInput
} from '@src/renderer/src/components/options/AnkiTab'
import { defaultAnkiSettings, mergeAnkiSettings } from '@src/shared/anki'

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing
// policy — same pattern OptionsMenu.test.tsx uses.

function noop(): void {}

function renderTab(overrides: Partial<React.ComponentProps<typeof AnkiTab>> = {}): string {
  return renderToStaticMarkup(
    <AnkiTab
      ankiSettings={defaultAnkiSettings}
      ankiDeckNames={[]}
      ankiModelNames={[]}
      ankiModelFields={[]}
      ankiPing={async () => ({ ok: false })}
      onChangeAnkiSettings={noop}
      {...overrides}
    />
  )
}

describe('AnkiTab markup', () => {
  it('renders the Anki tab with URL/deck/model inputs bound to ankiSettings', () => {
    const html = renderTab({
      ankiSettings: { ...defaultAnkiSettings, url: 'http://127.0.0.1:8765', deckName: 'Mining' },
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
    const html = renderTab({ ankiSettings: { ...defaultAnkiSettings, apiKey: 'secret' } })
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

  it('shows the API key as not set with the Clear button disabled when no key is stored', () => {
    const html = renderTab({ ankiSettings: { ...defaultAnkiSettings, apiKey: '' } })
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
    const frontOptions = html.match(/<option value="Front">Front<\/option>/g) ?? []
    expect(frontOptions).toHaveLength(9)
  })

  it('renders the tags input joined by ", " and the include-audio checkbox', () => {
    const html = renderTab({ ankiSettings: { ...defaultAnkiSettings, tags: ['kizuna', 'jp'] } })
    expect(html).toMatch(/id="anki-tags-input"[^>]*value="kizuna, jp"/)
    expect(html).toContain('id="anki-include-audio-checkbox"')
  })

  it('renders all duplicate-policy choices with the persisted selection', () => {
    const html = renderTab({
      ankiSettings: { ...defaultAnkiSettings, duplicatePolicy: 'overwrite' }
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

  it('does not fire onChangeAnkiSettings merely by rendering', () => {
    const onChangeAnkiSettings = vi.fn()
    renderTab({ onChangeAnkiSettings })
    expect(onChangeAnkiSettings).not.toHaveBeenCalled()
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
      ankiSettings: { ...defaultAnkiSettings, url: 'http://192.168.1.20:8765' }
    })
    expect(remote).toContain('id="anki-url-warning"')
    expect(remote).toContain('not on this machine')

    const local = renderTab({
      ankiSettings: { ...defaultAnkiSettings, url: 'http://127.0.0.1:8765' }
    })
    expect(local).not.toContain('anki-url-warning')
  })

  it('defaults and validates the persisted duplicate policy', () => {
    expect(defaultAnkiSettings.duplicatePolicy).toBe('prevent-deck')
    expect(mergeAnkiSettings({ duplicatePolicy: 'prevent-global' }).duplicatePolicy).toBe(
      'prevent-global'
    )
    expect(mergeAnkiSettings({ duplicatePolicy: 'unknown' }).duplicatePolicy).toBe('prevent-deck')
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

describe('AnkiTab picture mapping', () => {
  it('renders a Picture mapping row alongside the other mapped fields', () => {
    const html = renderTab({ ankiModelFields: ['Word', 'Screenshot'] })

    expect(html).toContain('id="anki-field-picture-select"')
    expect(html).toContain('>Picture</label>')
    expect(html).toMatch(/<option value="Screenshot"[^>]*>Screenshot<\/option>/)
  })

  it('binds the Picture select to the persisted mapping', () => {
    const html = renderTab({
      ankiSettings: {
        ...defaultAnkiSettings,
        fieldMap: { ...defaultAnkiSettings.fieldMap, picture: 'Screenshot' }
      },
      ankiModelFields: ['Screenshot']
    })

    expect(html).toMatch(
      /id="anki-field-picture-select"[\s\S]*?<option value="Screenshot" selected/
    )
  })

  // The mapping is the switch: no separate toggle may reappear beside it, or a
  // mapped field silently mines cards with no picture again.
  it('renders no include-screenshot toggle', () => {
    expect(renderTab({})).not.toContain('anki-include-screenshot-checkbox')
  })

  it('explains that mapping Picture is what enables the capture', () => {
    expect(renderTab({})).toContain('id="anki-media-mapping-hint"')
  })

  it('defaults the Picture mapping to unset', () => {
    // What a settings file written before this feature merges to.
    const merged = mergeAnkiSettings({ deckName: 'Japanese' })

    expect(merged.fieldMap.picture).toBe('')
    expect(renderTab({ ankiSettings: merged })).toMatch(
      /id="anki-field-picture-select"[\s\S]*?<option value="" selected/
    )
  })
})

describe('AnkiTab frequency mapping', () => {
  it('renders a Frequency mapping row alongside the other mapped fields', () => {
    const html = renderTab({ ankiModelFields: ['Word', 'Freq'] })

    expect(html).toContain('id="anki-field-frequency-select"')
    expect(html).toContain('>Frequency</label>')
  })

  it('binds the Frequency select to the persisted mapping', () => {
    const html = renderTab({
      ankiSettings: {
        ...defaultAnkiSettings,
        fieldMap: { ...defaultAnkiSettings.fieldMap, frequency: 'Freq' }
      },
      ankiModelFields: ['Freq']
    })

    expect(html).toMatch(/id="anki-field-frequency-select"[\s\S]*?<option value="Freq" selected/)
  })

  // Mapping the row is the opt-in; a separate checkbox would let a mapped field
  // mine blank frequencies, exactly as the retired media toggles did.
  it('renders no include-frequency toggle', () => {
    expect(renderTab({})).not.toContain('anki-include-frequency-checkbox')
  })

  it('defaults the mapping to unset for a pre-feature settings file', () => {
    const merged = mergeAnkiSettings({ deckName: 'Japanese' })

    expect(merged.fieldMap.frequency).toBe('')
    expect(renderTab({ ankiSettings: merged })).toMatch(
      /id="anki-field-frequency-select"[\s\S]*?<option value="" selected/
    )
  })
})

describe('AnkiTab pitch-accent mapping', () => {
  it('renders a Pitch accent mapping row alongside the other mapped fields', () => {
    const html = renderTab({ ankiModelFields: ['Word', 'Pitch'] })

    expect(html).toContain('id="anki-field-pitchAccent-select"')
    expect(html).toContain('>Pitch accent</label>')
  })

  it('binds the Pitch accent select to the persisted mapping', () => {
    const html = renderTab({
      ankiSettings: {
        ...defaultAnkiSettings,
        fieldMap: { ...defaultAnkiSettings.fieldMap, pitchAccent: 'Pitch' }
      },
      ankiModelFields: ['Pitch']
    })

    expect(html).toMatch(/id="anki-field-pitchAccent-select"[\s\S]*?<option value="Pitch" selected/)
  })

  // Mapping the row is the opt-in, exactly as for Frequency.
  it('renders no include-pitch toggle', () => {
    expect(renderTab({})).not.toContain('anki-include-pitch-checkbox')
  })

  it('defaults the mapping to unset for a pre-feature settings file', () => {
    const merged = mergeAnkiSettings({ deckName: 'Japanese' })

    expect(merged.fieldMap.pitchAccent).toBe('')
    expect(renderTab({ ankiSettings: merged })).toMatch(
      /id="anki-field-pitchAccent-select"[\s\S]*?<option value="" selected/
    )
  })
})

describe('AnkiTab sentence-audio mapping', () => {
  it('renders a Sentence audio mapping row alongside the other mapped fields', () => {
    const html = renderTab({ ankiModelFields: ['Word', 'SentenceAudio'] })

    expect(html).toContain('id="anki-field-sentenceAudio-select"')
    expect(html).toContain('>Sentence audio</label>')
  })

  it('binds the Sentence audio select to the persisted mapping', () => {
    const html = renderTab({
      ankiSettings: {
        ...defaultAnkiSettings,
        fieldMap: { ...defaultAnkiSettings.fieldMap, sentenceAudio: 'SentenceAudio' }
      },
      ankiModelFields: ['SentenceAudio']
    })

    expect(html).toMatch(
      /id="anki-field-sentenceAudio-select"[\s\S]*?<option value="SentenceAudio" selected/
    )
  })

  it('renders no include-sentence-audio toggle', () => {
    expect(renderTab({})).not.toContain('anki-include-sentence-audio-checkbox')
  })

  it('defaults the mapping to unset for a pre-feature settings file', () => {
    const merged = mergeAnkiSettings({ deckName: 'Japanese' })

    expect(merged.fieldMap.sentenceAudio).toBe('')
    expect(renderTab({ ankiSettings: merged })).toMatch(
      /id="anki-field-sentenceAudio-select"[\s\S]*?<option value="" selected/
    )
  })
})
