import { useEffect, useState } from 'react'
import { APP_NAME } from '../../../../shared/appInfo'
import { audioDeviceMenuList, type AudioDevice } from '../../../../shared/audioDevice'
import {
  MPV_EXTRA_ARG_MAX_LENGTH,
  normalizePreferredUrlSubtitleLanguage
} from '../../../../shared/playerSettings'
import type { SettingEntry } from './types'
import OptionsToggleRow from './OptionsToggleRow'

export interface PlaybackTabProps {
  active: boolean
  skipSeconds: number
  rightClickTogglePause: boolean
  autoPlayNext: boolean
  preferredUrlSubtitleLanguage: string
  audioDevices: AudioDevice[]
  selectedAudioDevice: string
  onSelectAudioDevice: (name: string) => void
  loudnessNormalization: boolean
  onToggleLoudnessNorm: () => void
  screenshotFolder: string | null
  mpvUserConfig: boolean
  mpvExtraArgs: string[]
  onChangeSkipSeconds: (value: number) => void
  onChangeRightClickTogglePause: (value: boolean) => void
  onChangeAutoPlayNext: (value: boolean) => void
  onChangePreferredUrlSubtitleLanguage: (value: string) => void
  onChangeScreenshotFolder: (value: string | null) => void
  onChangeMpvUserConfig: (value: boolean) => void
  onChangeMpvExtraArgs: (value: string[]) => void
  onOpenMpvConfigDir: () => void
  onAudioDevicesRequest: () => void
}

export function parseMpvExtraArgs(rawValue: string): string[] {
  return rawValue
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && line.length <= MPV_EXTRA_ARG_MAX_LENGTH)
}

export const PLAYBACK_SETTING_ENTRIES: SettingEntry[] = [
  {
    id: 'skip-seconds',
    label: 'Skip back/ahead seconds',
    category: 'playback',
    keywords: ['skip', 'jump', 'seek', 'amount'],
    targetId: 'skip-seconds-input'
  },
  {
    id: 'auto-play-next',
    label: 'Auto-play next file',
    category: 'playback',
    keywords: ['playlist', 'continue', 'autoplay'],
    targetId: 'auto-play-next-checkbox'
  },
  {
    id: 'preferred-url-subtitle-language',
    label: 'Preferred online subtitle language',
    category: 'playback',
    keywords: ['yt-dlp', 'url', 'youtube', 'language'],
    targetId: 'preferred-url-subtitle-language-input'
  },
  {
    id: 'right-click-toggle-pause',
    label: 'Right-click toggles play/pause',
    category: 'playback',
    keywords: ['mouse', 'pause'],
    targetId: 'right-click-toggle-pause-checkbox'
  },
  {
    id: 'screenshot-folder',
    label: 'Screenshot folder',
    category: 'playback',
    keywords: ['capture', 'save', 'pictures'],
    targetId: 'screenshot-folder-input'
  },
  {
    id: 'audio-device',
    label: 'Audio output device',
    category: 'playback',
    keywords: ['sound', 'speakers', 'headphones', 'hdmi'],
    targetId: 'audio-device-select'
  },
  {
    id: 'loudness-normalization',
    label: 'Normalize loudness',
    category: 'playback',
    keywords: ['volume', 'audio', 'dynaudnorm', 'compressor'],
    targetId: 'loudness-normalization-checkbox'
  },
  {
    id: 'mpv-user-config',
    label: 'Load my mpv config folder',
    category: 'playback',
    keywords: ['mpv.conf', 'input.conf', 'scripts', 'shaders', 'advanced'],
    targetId: 'mpv-user-config-checkbox'
  },
  {
    id: 'mpv-extra-args',
    label: 'Extra mpv arguments',
    category: 'playback',
    keywords: ['command line', 'hwdec', 'profile', 'advanced'],
    targetId: 'mpv-extra-args-input'
  },
  {
    id: 'mpv-config-dir',
    label: 'Open mpv config folder',
    category: 'playback',
    keywords: ['explorer', 'advanced'],
    targetId: 'mpv-open-config-folder'
  }
]

/** Playback behavior, audio output, and advanced mpv settings. */
export default function PlaybackTab({
  active,
  skipSeconds,
  rightClickTogglePause,
  autoPlayNext,
  preferredUrlSubtitleLanguage,
  audioDevices,
  selectedAudioDevice,
  onSelectAudioDevice,
  loudnessNormalization,
  onToggleLoudnessNorm,
  screenshotFolder,
  mpvUserConfig,
  mpvExtraArgs,
  onChangeSkipSeconds,
  onChangeRightClickTogglePause,
  onChangeAutoPlayNext,
  onChangePreferredUrlSubtitleLanguage,
  onChangeScreenshotFolder,
  onChangeMpvUserConfig,
  onChangeMpvExtraArgs,
  onOpenMpvConfigDir,
  onAudioDevicesRequest
}: PlaybackTabProps): React.JSX.Element {
  const [screenshotFolderDraft, setScreenshotFolderDraft] = useState<string | null>(null)
  const [preferredUrlSubtitleLanguageDraft, setPreferredUrlSubtitleLanguageDraft] = useState<
    string | null
  >(null)
  const [mpvExtraArgsDraft, setMpvExtraArgsDraft] = useState<string | null>(null)

  useEffect(() => {
    if (active) onAudioDevicesRequest()
  }, [active, onAudioDevicesRequest])

  const commitScreenshotFolder = (): void => {
    if (screenshotFolderDraft === null) return
    const trimmed = screenshotFolderDraft.trim()
    onChangeScreenshotFolder(trimmed === '' ? null : trimmed)
    setScreenshotFolderDraft(null)
  }

  const commitPreferredUrlSubtitleLanguage = (): void => {
    if (preferredUrlSubtitleLanguageDraft === null) return
    onChangePreferredUrlSubtitleLanguage(
      normalizePreferredUrlSubtitleLanguage(preferredUrlSubtitleLanguageDraft)
    )
    setPreferredUrlSubtitleLanguageDraft(null)
  }

  const commitMpvExtraArgs = (): void => {
    if (mpvExtraArgsDraft === null) return
    onChangeMpvExtraArgs(parseMpvExtraArgs(mpvExtraArgsDraft))
    setMpvExtraArgsDraft(null)
  }

  return (
    <section className={active ? 'options-tab active' : 'options-tab'} aria-hidden={!active}>
      <div className="options-section">
        <h3>Skip amount</h3>
        <div className="options-row">
          <label htmlFor="skip-seconds-input" className="options-row-label">
            Skip back/ahead seconds
            <span className="options-row-description">
              Used by the arrow keys and the transport skip buttons.
            </span>
          </label>
          <input
            type="number"
            id="skip-seconds-input"
            min={1}
            max={120}
            value={skipSeconds}
            onChange={(e) => {
              const value = Number(e.target.value)
              if (Number.isFinite(value) && value > 0) onChangeSkipSeconds(value)
            }}
          />
        </div>
        <OptionsToggleRow
          id="auto-play-next-checkbox"
          title="Auto-play next file"
          description="At the end of a file, continue with the next video in the folder; an active playlist takes priority."
          checked={autoPlayNext}
          onChange={onChangeAutoPlayNext}
        />
        <div className="options-row">
          <label htmlFor="preferred-url-subtitle-language-input" className="options-row-label">
            Preferred online subtitle language
            <span className="options-row-description">
              Matching online (yt-dlp) caption tracks sort first. Blank means no preference.
            </span>
          </label>
          <input
            type="text"
            id="preferred-url-subtitle-language-input"
            placeholder="e.g. ja"
            value={preferredUrlSubtitleLanguageDraft ?? preferredUrlSubtitleLanguage}
            onChange={(e) => setPreferredUrlSubtitleLanguageDraft(e.target.value)}
            onBlur={commitPreferredUrlSubtitleLanguage}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              else if (e.key === 'Escape') setPreferredUrlSubtitleLanguageDraft(null)
            }}
          />
        </div>
        <OptionsToggleRow
          id="right-click-toggle-pause-checkbox"
          title="Right-click toggles play/pause"
          description="Right-clicking the video pauses or resumes instead of opening a menu."
          checked={rightClickTogglePause}
          onChange={onChangeRightClickTogglePause}
        />
        <div className="options-row">
          <label htmlFor="screenshot-folder-input" className="options-row-label">
            Screenshot folder
            <span className="options-row-description">{`Blank saves to Pictures\\${APP_NAME}.`}</span>
          </label>
          <input
            type="text"
            id="screenshot-folder-input"
            placeholder={`Pictures\\${APP_NAME} (default)`}
            value={screenshotFolderDraft ?? screenshotFolder ?? ''}
            onChange={(e) => setScreenshotFolderDraft(e.target.value)}
            onBlur={commitScreenshotFolder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              else if (e.key === 'Escape') setScreenshotFolderDraft(null)
            }}
          />
        </div>
      </div>

      <div className="options-section">
        <h3>Audio output</h3>
        <div className="options-row">
          <label htmlFor="audio-device-select" className="options-row-label">
            Output device
            <span className="options-row-description">
              Falls back to the system default if the device disappears.
            </span>
          </label>
          <select
            id="audio-device-select"
            value={selectedAudioDevice}
            onChange={(e) => onSelectAudioDevice(e.target.value)}
          >
            {audioDeviceMenuList(audioDevices).map((device) => (
              <option key={device.name} value={device.name}>
                {device.description}
              </option>
            ))}
          </select>
        </div>
        <OptionsToggleRow
          id="loudness-normalization-checkbox"
          title="Normalize loudness"
          description={<>Uses mpv&rsquo;s dynamic audio-normalization filter.</>}
          checked={loudnessNormalization}
          onChange={onToggleLoudnessNorm}
        />
      </div>

      <div className="options-section">
        <h3>mpv (advanced)</h3>
        <p className="options-hint">Changes take effect after restarting Kizuna.</p>
        <OptionsToggleRow
          id="mpv-user-config-checkbox"
          title="Load my mpv config folder"
          description={
            <>
              Reads mpv.conf, input.conf, scripts/ and shaders/ from Kizuna&rsquo;s mpv folder. Off
              runs mpv with --no-config.
            </>
          }
          checked={mpvUserConfig}
          onChange={onChangeMpvUserConfig}
        />
        <div className="options-row options-row-stacked">
          <label htmlFor="mpv-extra-args-input" className="options-row-label">
            Extra mpv arguments
            <span className="options-row-description">
              One argument per line. Only known playback-tuning options are passed to mpv; anything
              else is ignored.
            </span>
          </label>
          <textarea
            id="mpv-extra-args-input"
            className="options-mpv-args"
            rows={4}
            spellCheck={false}
            placeholder={'--hwdec=auto\n--profile=gpu-hq'}
            value={mpvExtraArgsDraft ?? mpvExtraArgs.join('\n')}
            onChange={(e) => setMpvExtraArgsDraft(e.target.value)}
            onBlur={commitMpvExtraArgs}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setMpvExtraArgsDraft(null)
            }}
          />
        </div>
        <div className="options-row">
          <button
            type="button"
            id="mpv-open-config-folder"
            className="options-button"
            onClick={onOpenMpvConfigDir}
          >
            Open mpv config folder
          </button>
        </div>
      </div>
    </section>
  )
}
