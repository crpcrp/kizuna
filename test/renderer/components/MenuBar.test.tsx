import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { isAnyMenuOpen } from '@src/renderer/src/components/MenuBar'
import {
  APPLY_FOLDER_FEEDBACK_MS,
  SPEED_PRESETS,
  SUBTITLE_OFFSET_STEP_MS,
  VIDEO_SCALE_PRESETS,
  abLoopPhaseLabel,
  parseOffsetMs,
  applyFolderLabel,
  audioTracks,
  languageBadge,
  subtitleTracks,
  trackLabel
} from '@src/renderer/src/components/menu/utils'
import { TestMenuBar as MenuBar } from './menu/menuBarTestAdapter'
import type { Track } from '@src/shared/track'
import type { RecentMediaFile } from '@src/shared/mediaHistory'

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing policy.
// Dropdown open/close is client-only useState; the panels are always in the
// DOM (CSS toggles visibility), so markup assertions can see every item.

const audio1: Track = { id: 1, kind: 'audio', codec: 'aac', language: 'jpn' }
const audio2: Track = { id: 2, kind: 'audio', codec: 'ac3', language: 'eng' }
const sub1: Track = { id: 3, kind: 'subtitle', codec: 'ass', title: 'Full', language: 'eng' }

const tracks = [audio1, audio2, sub1]

function noop(): void {}

describe('track helpers', () => {
  it('audioTracks / subtitleTracks partition by kind', () => {
    expect(audioTracks(tracks)).toEqual([audio1, audio2])
    expect(subtitleTracks(tracks)).toEqual([sub1])
  })

  it('languageBadge maps known codes and falls back for others', () => {
    expect(languageBadge('jpn')).toBe('JP')
    expect(languageBadge('eng')).toBe('EN')
    expect(languageBadge('xyz')).toBe('XY')
    expect(languageBadge('und')).toBeNull()
    expect(languageBadge(undefined)).toBeNull()
  })

  it('trackLabel prefers the title, then codec, with a language badge', () => {
    expect(trackLabel(sub1)).toBe('[EN] Full')
    expect(trackLabel(audio1)).toBe('[JP] aac')
    expect(trackLabel({ id: 9, kind: 'audio', codec: 'flac' })).toBe('flac')
  })

  it('isAnyMenuOpen reports true only when a category id is set', () => {
    // Regression: in fullscreen, App used pointer-Y alone (edgeReveal) to
    // decide whether to keep the top bar revealed, so moving the cursor
    // down into an open dropdown (below the reveal threshold) slid the bar
    // away mid-click before the item could be clicked ("dropdown appears,
    // then disappears, nothing else happens"). App now also ORs in this
    // signal, fed by MenuBar's onOpenChange, to keep the bar up while any
    // dropdown is open regardless of pointer position.
    expect(isAnyMenuOpen(null)).toBe(false)
    expect(isAnyMenuOpen('playback')).toBe(true)
    expect(isAnyMenuOpen('audio')).toBe(true)
  })
})

describe('MenuBar markup', () => {
  const html = renderToStaticMarkup(
    <MenuBar
      tracks={tracks}
      selectedAudioId={1}
      selectedSubtitleId={null}
      onOpenFile={noop}
      onSelectAudio={noop}
      onSelectSubtitle={noop}
      onOpenOptions={noop}
    />
  )

  it('renders categories in the application-menu order', () => {
    const order = [
      'id="menu-media"',
      'id="menu-video"',
      'id="menu-audio"',
      'id="menu-subtitle"',
      'id="menu-playback"',
      'id="menu-vocabulary"',
      'id="menu-settings"'
    ]
    for (const id of order) expect(html).toContain(id)
    const positions = order.map((id) => html.indexOf(id))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('renders the Open file item', () => {
    expect(html).toContain('aria-label="Open file"')
  })

  it('lists audio and subtitle tracks with an Off option', () => {
    expect(html).toContain('[JP] aac')
    expect(html).toContain('[EN] ac3')
    expect(html).toContain('[EN] Full')
    expect(html).toContain('Off')
  })

  it('marks the selected audio track as checked', () => {
    // audio1 (id 1) is selected → aria-checked="true" appears
    expect(html).toContain('aria-checked="true"')
  })

  it('renders Settings as a menu with Options and About Kizuna items', () => {
    expect(html).toContain('id="menu-settings"')
    expect(html).toContain('id="open-options"')
    expect(html).toContain('aria-label="Options"')
    expect(html).toContain('Options…')
    expect(html).toContain('id="open-about-kizuna"')
    expect(html).toContain('About Kizuna')
    expect(html).not.toContain('fullscreen')
  })

  it('renders the Video menu category with size presets and Original size label', () => {
    expect(html).toContain('id="menu-video"')
    expect(html).toContain('50%')
    expect(html).toContain('Original size (100%)')
    expect(html).toContain('150%')
    expect(html).toContain('200%')
    expect(html).toContain('Always on top')
  })

  it('leaves the trimmed and moved items out of the Video panel', () => {
    const videoPanel = html.slice(html.indexOf('id="menu-video"'), html.indexOf('id="menu-audio"'))
    // Screenshot is keybinding-only now, and chapters live on the seek bar.
    expect(videoPanel).not.toContain('Save screenshot')
    expect(videoPanel).not.toContain('Chapters')
    expect(videoPanel).not.toContain('Speed')
    expect(videoPanel).not.toContain('A–B loop')
    expect(videoPanel).not.toContain('one frame')
    // The whole bar carries no screenshot or chapter item any more.
    expect(html).not.toContain('Save screenshot')
    expect(html).not.toContain('>Chapters<')
  })

  it('defaults the subtitle offset row to 0 ms', () => {
    expect(html).toContain('id="subtitle-offset-value"')
    expect(html).toContain('value="0"')
    expect(html).toContain('ms')
  })

  it('renders the audio delay row defaulting to 0 ms', () => {
    expect(html).toContain('id="audio-delay-row"')
    expect(html).toContain('id="audio-delay-value"')
    expect(html).toContain('aria-label="Audio delay in milliseconds"')
  })
})

describe('Audio menu keeps only per-file controls', () => {
  // Output device + loudness normalization are persistent preferences, so they
  // live in Options > Playback > Audio output now (see OptionsMenu tests).
  it('renders neither the device list nor the normalize-loudness item', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedAudioId={1}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
      />
    )
    expect(html).not.toContain('id="audio-device-list"')
    expect(html).not.toContain('Autoselect device')
    expect(html).not.toContain('Normalize loudness')
    // The contextual controls stay.
    expect(html).toContain('id="audio-delay-row"')
    expect(html).toContain('[EN] ac3')
  })
})

describe('MenuBar "Load subtitle file…"', () => {
  it('renders the item above the track list when the callback is supplied', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onLoadSubtitleFile={noop}
        onOpenOptions={noop}
      />
    )
    expect(html).toContain('id="load-subtitle-file"')
    expect(html).toContain('Load subtitle file…')
    // Above the track list: an external file is picked, not selected.
    expect(html.indexOf('id="load-subtitle-file"')).toBeLessThan(html.indexOf('[EN] Full'))
  })

  it('omits the item without a video loaded (no callback)', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
      />
    )
    expect(html).not.toContain('id="load-subtitle-file"')
    expect(html).not.toContain('Load subtitle file…')
  })

  // A media open in flight is about to replace the video, so the dialog
  // must not be opened against the outgoing one.
  it('disables the item while mediaOpening, enables it otherwise', () => {
    const render = (mediaOpening: boolean): string =>
      renderToStaticMarkup(
        <MenuBar
          tracks={tracks}
          selectedSubtitleId={null}
          onOpenFile={noop}
          onSelectAudio={noop}
          onSelectSubtitle={noop}
          onLoadSubtitleFile={noop}
          onOpenOptions={noop}
          mediaOpening={mediaOpening}
        />
      )
    expect(render(true)).toMatch(/id="load-subtitle-file"[^>]*disabled/)
    expect(render(false)).not.toMatch(/id="load-subtitle-file"[^>]*disabled/)
  })
})

describe('MenuBar external subtitle encoding', () => {
  it('shows the active sidecar encoding control only for the external track', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={-1}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        externalSubtitleEncoding="shift_jis"
        onChangeExternalSubtitleEncoding={noop}
      />
    )
    expect(html).toContain('id="external-subtitle-encoding"')
    expect(html).toContain('value="shift_jis"')
    expect(html).toContain('Shift-JIS')
  })
})

describe('MenuBar subtitle offset row', () => {
  it('shows the current offset value and disables Reset at 0', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        subtitleOffsetMs={250}
      />
    )
    expect(html).toContain('value="250"')
    expect(html).not.toMatch(/aria-label="Reset subtitle offset" disabled/)
  })

  it('disables Reset when the offset is already 0', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        subtitleOffsetMs={0}
      />
    )
    expect(html).toMatch(/aria-label="Reset subtitle offset" disabled/)
  })
})

describe('MenuBar "Apply to folder"', () => {
  it('renders the button, with its tooltip, when the callback is supplied', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        subtitleOffsetMs={250}
        onApplyOffsetToFolder={noop}
      />
    )
    expect(html).toContain('id="subtitle-offset-folder-row"')
    expect(html).toContain('aria-label="Apply subtitle offset to folder"')
    expect(html).toContain('title="Use this offset for every video in this folder"')
    expect(html).toContain('Apply to folder')
  })

  it('hides the button when no callback is supplied (App omits it with no file loaded)', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        subtitleOffsetMs={250}
      />
    )
    expect(html).not.toContain('id="subtitle-offset-folder-row"')
    expect(html).not.toContain('Apply to folder')
  })

  it('applyFolderLabel swaps in the confirmation while the feedback window is up', () => {
    expect(applyFolderLabel(false)).toBe('Apply to folder')
    expect(applyFolderLabel(true)).toBe('Applied ✓')
    expect(APPLY_FOLDER_FEEDBACK_MS).toBeGreaterThan(0)
  })
})

describe('MenuBar video menu', () => {
  it('checks the Always on top item when alwaysOnTop is true, unchecked otherwise', () => {
    const checked = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        alwaysOnTop
      />
    )
    const unchecked = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        alwaysOnTop={false}
      />
    )
    expect(checked).toContain('✓</span><span class="menu-item-label">Always on top')
    expect(unchecked).not.toContain('✓</span><span class="menu-item-label">Always on top')
  })

  it('checks the Mini player item when active, unchecked otherwise', () => {
    const active = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        miniPlayer
      />
    )
    const inactive = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        miniPlayer={false}
      />
    )
    expect(active).toContain('✓</span><span class="menu-item-label">Mini player')
    expect(inactive).toContain('Mini player')
    expect(inactive).not.toContain('✓</span><span class="menu-item-label">Mini player')
  })

  it('exposes the exact size presets used to render the menu', () => {
    expect(VIDEO_SCALE_PRESETS).toEqual([0.5, 1, 1.5, 2])
  })

  it('exposes the offset step size', () => {
    expect(SUBTITLE_OFFSET_STEP_MS).toBe(50)
  })

  it('renders no screenshot item — capture is keybinding-only', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        hasFile
      />
    )
    expect(html).not.toContain('Save screenshot')
    expect(html).not.toContain('screenshot')
  })

  it('renders the video-adjustments item, enabled regardless of a loaded file', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        hasFile={false}
        onOpenVideoAdjustments={noop}
      />
    )
    expect(html).toContain('id="open-video-adjustments"')
    expect(html).toContain('Adjustments…')
    // The item is not disabled — picture adjustments persist even with no file.
    expect(html).not.toContain(
      'id="open-video-adjustments" aria-label="Video adjustments" disabled=""'
    )
  })
})

describe('MenuBar playback menu', () => {
  /** The Playback panel's slice of the bar, up to the next category. */
  function playbackPanel(html: string): string {
    return html.slice(html.indexOf('id="menu-playback"'), html.indexOf('id="menu-vocabulary"'))
  }

  it('renders speed presets and a custom-speed readout inside Playback', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        speed={2.75}
      />
    )
    expect(SPEED_PRESETS).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2])
    const panel = playbackPanel(html)
    expect(panel).toContain('Speed')
    expect(panel).toContain('0.75×')
    expect(panel).toContain('2.75×')
  })

  it('holds the A–B loop and both frame-step items', () => {
    const panel = playbackPanel(
      renderToStaticMarkup(
        <MenuBar
          tracks={tracks}
          selectedSubtitleId={null}
          onOpenFile={noop}
          onSelectAudio={noop}
          onSelectSubtitle={noop}
          onOpenOptions={noop}
          hasFile
          onCycleAbLoop={noop}
          onFrameStep={noop}
          onFrameBack={noop}
        />
      )
    )
    expect(panel).toContain('A–B loop')
    expect(panel).toContain('Step forward one frame')
    expect(panel).toContain('Step back one frame')
  })

  it('labels the A–B loop item by its cycle phase and checks it once armed', () => {
    expect(abLoopPhaseLabel(undefined)).toBe('A–B loop')
    expect(abLoopPhaseLabel({ a: null, b: null })).toBe('A–B loop')
    expect(abLoopPhaseLabel({ a: 12, b: null })).toBe('A–B loop · A set')
    expect(abLoopPhaseLabel({ a: 12, b: 30 })).toBe('A–B loop · looping')

    const looping = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        hasFile
        abLoop={{ a: 12, b: 30 }}
        onCycleAbLoop={noop}
      />
    )
    expect(looping).toContain('✓</span><span class="menu-item-label">A–B loop · looping')

    const off = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        hasFile={false}
        abLoop={{ a: null, b: null }}
        onCycleAbLoop={noop}
      />
    )
    // Off phase: not checked, and disabled without a loaded file.
    expect(off).toContain(
      'disabled=""><span class="menu-item-check"></span><span class="menu-item-label">A–B loop'
    )
    expect(off).not.toContain('✓</span><span class="menu-item-label">A–B loop')
  })

  it('renders the frame-step items, disabled without a file and enabled with one', () => {
    const noFile = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        hasFile={false}
        onFrameStep={noop}
        onFrameBack={noop}
      />
    )
    const withFile = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        hasFile
        onFrameStep={noop}
        onFrameBack={noop}
      />
    )
    expect(noFile).toContain('Step forward one frame')
    expect(noFile).toContain('Step back one frame')
    expect(noFile).toContain(
      'disabled=""><span class="menu-item-check"></span><span class="menu-item-label">Step forward one frame'
    )
    expect(noFile).toContain(
      'disabled=""><span class="menu-item-check"></span><span class="menu-item-label">Step back one frame'
    )
    expect(withFile).not.toContain(
      'disabled=""><span class="menu-item-check"></span><span class="menu-item-label">Step forward one frame'
    )
    expect(withFile).not.toContain(
      'disabled=""><span class="menu-item-check"></span><span class="menu-item-label">Step back one frame'
    )
  })
})

describe('parseOffsetMs (pure)', () => {
  it('parses a positive integer', () => {
    expect(parseOffsetMs('1234')).toBe(1234)
  })

  it('parses a negative integer', () => {
    expect(parseOffsetMs('-750')).toBe(-750)
  })

  it('trims surrounding whitespace', () => {
    expect(parseOffsetMs('  99 ')).toBe(99)
  })

  it('rounds a fractional value to the nearest ms', () => {
    expect(parseOffsetMs('12.6')).toBe(13)
  })

  it('returns null for an empty (or whitespace-only) string', () => {
    expect(parseOffsetMs('')).toBeNull()
    expect(parseOffsetMs('   ')).toBeNull()
  })

  it('returns null for non-numeric text', () => {
    expect(parseOffsetMs('abc')).toBeNull()
  })

  it('parses a leading-dot fraction', () => {
    expect(parseOffsetMs('.5')).toBe(1)
  })

  it('rejects scientific notation', () => {
    expect(parseOffsetMs('2e+23')).toBeNull()
    expect(parseOffsetMs('1e3')).toBeNull()
    expect(parseOffsetMs('1E-3')).toBeNull()
  })

  it('rejects non-finite and other Number-parseable junk', () => {
    expect(parseOffsetMs('Infinity')).toBeNull()
    expect(parseOffsetMs('-Infinity')).toBeNull()
    expect(parseOffsetMs('NaN')).toBeNull()
    expect(parseOffsetMs('0x1F')).toBeNull()
  })
})

describe('MenuBar subtitle offset text field', () => {
  it('renders a free-text number input carrying the current offset, alongside the +/- and Reset buttons', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        subtitleOffsetMs={250}
      />
    )
    expect(html).toContain('id="subtitle-offset-value"')
    expect(html).toContain('type="number"')
    expect(html).toContain('value="250"')
    expect(html).toContain('aria-label="Decrease subtitle offset"')
    expect(html).toContain('aria-label="Increase subtitle offset"')
    expect(html).toContain('aria-label="Reset subtitle offset"')
  })
})

describe('MenuBar sidebar toggle', () => {
  it('checks "Show subtitle sidebar" when sidebarOpen is true, unchecked otherwise', () => {
    const checked = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        sidebarOpen
      />
    )
    const unchecked = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        sidebarOpen={false}
      />
    )
    expect(checked).toContain('✓</span><span class="menu-item-label">Show subtitle sidebar')
    expect(unchecked).not.toContain('✓</span><span class="menu-item-label">Show subtitle sidebar')
  })

  it('is a no-op to render with onToggleSidebar wired (not fired at render)', () => {
    const onToggleSidebar = vi.fn()
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        onToggleSidebar={onToggleSidebar}
      />
    )
    expect(html).toContain('Show subtitle sidebar')
    expect(onToggleSidebar).not.toHaveBeenCalled()
  })
})

describe('MenuBar Vocabulary commands', () => {
  it('renders both commands only in Vocabulary with stable ids and accessible labels', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
      />
    )
    const subtitlePanel = html.slice(
      html.indexOf('id="menu-subtitle"'),
      html.indexOf('id="menu-playback"')
    )
    const vocabularyPanel = html.slice(
      html.indexOf('id="menu-vocabulary"'),
      html.indexOf('id="menu-settings"')
    )
    expect(vocabularyPanel).toContain('id="open-word-report"')
    expect(vocabularyPanel).toContain('aria-label="Word report"')
    expect(vocabularyPanel).toContain('Word report…')
    expect(vocabularyPanel).toContain('id="open-bulk-mining"')
    expect(vocabularyPanel).toContain('aria-label="Bulk Anki mining"')
    expect(vocabularyPanel).toContain('Bulk Anki mining…')
    expect(subtitlePanel).not.toContain('open-word-report')
    expect(subtitlePanel).not.toContain('open-bulk-mining')
    expect(html).not.toContain('open-subtitle-report')
  })

  it('does not invoke either callback while rendering', () => {
    const onOpenWordReport = vi.fn()
    const onOpenBulkMining = vi.fn()
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        onOpenWordReport={onOpenWordReport}
        onOpenBulkMining={onOpenBulkMining}
      />
    )
    expect(html).toContain('Word report…')
    expect(html).toContain('Bulk Anki mining…')
    expect(onOpenWordReport).not.toHaveBeenCalled()
    expect(onOpenBulkMining).not.toHaveBeenCalled()
  })
})

describe('MenuBar with no tracks', () => {
  it('keeps every menu valid, including Vocabulary', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={[]}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
      />
    )
    expect(html).toContain('No audio tracks')
    expect(html).toContain('id="menu-vocabulary"')
    expect(html).toContain('id="open-word-report"')
    expect(html).toContain('id="open-bulk-mining"')
  })
})

describe('MenuBar recent files', () => {
  const recent: RecentMediaFile[] = [
    { path: 'C:\\Media\\episode05.mkv', openedAt: 2 },
    { path: 'C:\\Media\\episode04.mkv', openedAt: 1 }
  ]

  it('shows disabled "No recent files" when the list is empty', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
      />
    )
    expect(html).toContain('No recent files')
  })

  it('lists basenames newest-first, exposing the full path via title', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        recentFiles={recent}
      />
    )
    expect(html.indexOf('episode05.mkv')).toBeLessThan(html.indexOf('episode04.mkv'))
    expect(html).toContain('title="C:\\Media\\episode05.mkv"')
    expect(html).not.toContain('C:\\Media\\episode05.mkv<')
  })

  it('keeps recent entries in the Media panel scroll flow', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        recentFiles={recent}
      />
    )
    const mediaPanelStart = html.indexOf('id="menu-media"')
    const videoMenuStart = html.indexOf('id="menu-video"')
    const mediaMarkup = html.slice(mediaPanelStart, videoMenuStart)

    expect(mediaMarkup).toContain('class="menu-panel"')
    expect(mediaMarkup).toContain('class="menu-recent-list"')
    expect(mediaMarkup.indexOf('class="menu-recent-list"')).toBeLessThan(
      mediaMarkup.indexOf('id="clear-recent-files"')
    )
    expect((mediaMarkup.match(/class="menu-panel/g) ?? []).length).toBe(1)
  })

  it('handles duplicate basenames from different folders distinctly via title', () => {
    const dup: RecentMediaFile[] = [
      { path: 'C:\\A\\video.mkv', openedAt: 2 },
      { path: 'C:\\B\\video.mkv', openedAt: 1 }
    ]
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        recentFiles={dup}
      />
    )
    expect(html).toContain('title="C:\\A\\video.mkv"')
    expect(html).toContain('title="C:\\B\\video.mkv"')
    expect((html.match(/>video\.mkv</g) ?? []).length).toBe(2)
  })

  it('disables Open file and every recent entry while mediaOpening', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        recentFiles={recent}
        mediaOpening
      />
    )
    expect(html).toMatch(/id="open-file"[^>]*disabled/)
    expect(html).toMatch(/title="C:\\Media\\episode05\.mkv"[^>]*disabled/)
  })

  it('disables Clear recent files when the list is empty, enables it otherwise', () => {
    const empty = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
      />
    )
    const withRecent = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        recentFiles={recent}
      />
    )
    expect(empty).toMatch(/id="clear-recent-files"[^>]*disabled/)
    expect(withRecent).not.toMatch(/id="clear-recent-files"[^>]*disabled/)
  })

  it('is a no-op to render with onOpenRecent/onClearRecentFiles wired (not fired at render)', () => {
    const onOpenRecent = vi.fn()
    const onClearRecentFiles = vi.fn()
    renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        recentFiles={recent}
        onOpenRecent={onOpenRecent}
        onClearRecentFiles={onClearRecentFiles}
      />
    )
    expect(onOpenRecent).not.toHaveBeenCalled()
    expect(onClearRecentFiles).not.toHaveBeenCalled()
  })
})

describe('MenuBar callbacks', () => {
  it('is a no-op to render with fakes (handlers wired, not fired at render)', () => {
    const onOpenFile = vi.fn()
    renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedSubtitleId={null}
        onOpenFile={onOpenFile}
        onSelectAudio={vi.fn()}
        onSelectSubtitle={vi.fn()}
        onOpenOptions={vi.fn()}
      />
    )
    expect(onOpenFile).not.toHaveBeenCalled()
  })
})

describe('MenuBar subtitle line controls', () => {
  it('omits line controls whether subtitles are off, selected, or have no cues', () => {
    const subtitlesOff = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedAudioId={1}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
      />
    )
    expect(subtitlesOff).not.toContain('Replay line')
    expect(subtitlesOff).not.toContain('Previous line')
    expect(subtitlesOff).not.toContain('Next line')
    expect(subtitlesOff).not.toContain('Loop line')
    expect(subtitlesOff).toContain('Show subtitle sidebar')
    expect(subtitlesOff).toContain('Offset')

    const selected = renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedAudioId={1}
        selectedSubtitleId={3}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
      />
    )
    expect(selected).not.toContain('Replay line')
    expect(selected).not.toContain('Previous line')
    expect(selected).not.toContain('Next line')
    expect(selected).not.toContain('Loop line')

    const withoutCues = renderToStaticMarkup(
      <MenuBar
        tracks={[]}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
      />
    )
    expect(withoutCues).not.toContain('Replay line')
    expect(withoutCues).not.toContain('Previous line')
    expect(withoutCues).not.toContain('Next line')
    expect(withoutCues).not.toContain('Loop line')
  })
})

describe('MenuBar playlist items (Media menu)', () => {
  function render(props: Partial<React.ComponentProps<typeof MenuBar>> = {}): string {
    return renderToStaticMarkup(
      <MenuBar
        tracks={tracks}
        selectedAudioId={1}
        selectedSubtitleId={null}
        onOpenFile={noop}
        onSelectAudio={noop}
        onSelectSubtitle={noop}
        onOpenOptions={noop}
        {...props}
      />
    )
  }

  it('renders the "Show playlist" toggle plus add/save items in the Media menu', () => {
    const html = render()
    expect(html).toContain('id="playlist-add-files"')
    expect(html).toContain('id="playlist-add-folder"')
    expect(html).toContain('id="playlist-save"')
    expect(html).toContain('Show playlist')
    expect(html).toContain('Add files…')
    expect(html).toContain('Add folder…')
    expect(html).toContain('Save playlist as .m3u…')
    // All live under the Media category, before the Video menu that follows it.
    expect(html.indexOf('id="playlist-save"')).toBeLessThan(html.indexOf('id="menu-video"'))
  })

  it('checks the "Show playlist" toggle when the panel is open', () => {
    expect(render({ playlistOpen: true })).toContain(
      '✓</span><span class="menu-item-label">Show playlist'
    )
    expect(render({ playlistOpen: false })).not.toContain(
      '✓</span><span class="menu-item-label">Show playlist'
    )
  })

  it('disables Save playlist until the queue has entries', () => {
    expect(render({ hasPlaylist: false })).toMatch(/id="playlist-save"[^>]*disabled/)
    expect(render({ hasPlaylist: true })).not.toMatch(/id="playlist-save"[^>]*disabled/)
  })
})
