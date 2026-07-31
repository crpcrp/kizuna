import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AudioMenu } from '@src/renderer/src/components/menu/AudioMenu'

const run = (action: () => void): (() => void) => action

describe('AudioMenu', () => {
  it('owns audio-track selection and per-file delay controls', () => {
    const html = renderToStaticMarkup(
      <AudioMenu
        open
        onToggle={vi.fn()}
        run={run}
        tracks={[
          { id: 1, kind: 'audio', codec: 'aac', language: 'jpn' },
          { id: 2, kind: 'subtitle', codec: 'ass', language: 'eng' }
        ]}
        selectedAudioId={1}
        hasFile
        audioDelayMs={125}
        onSelectAudio={vi.fn()}
      />
    )

    expect(html).toContain('[JP] aac')
    expect(html).not.toContain('[EN] ass')
    expect(html).toContain('value="125"')
    expect(html).toContain('aria-label="Reset audio delay"')
  })
})
