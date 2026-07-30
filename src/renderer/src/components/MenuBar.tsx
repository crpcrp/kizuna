import './MenuBar.css'
import { useEffect, useState } from 'react'
import { AudioMenu, type AudioMenuProps } from './menu/AudioMenu'
import { MediaMenu, type MediaMenuProps } from './menu/MediaMenu'
import { PlaybackMenu, type PlaybackMenuProps } from './menu/PlaybackMenu'
import { SubtitleMenu, type SubtitleMenuProps } from './menu/SubtitleMenu'
import { VideoMenu, type VideoMenuProps } from './menu/VideoMenu'
import { VocabularyMenu, type VocabularyMenuProps } from './menu/VocabularyMenu'

export { YTDLP_QUALITY_OPTIONS } from './menu/VideoMenu'
export {
  APPLY_FOLDER_FEEDBACK_MS,
  AUDIO_DELAY_STEP_MS,
  SPEED_PRESETS,
  SUBTITLE_OFFSET_STEP_MS,
  VIDEO_SCALE_PRESETS,
  abLoopPhaseLabel,
  applyFolderLabel,
  audioTracks,
  languageBadge,
  parseOffsetMs,
  subtitleTracks,
  trackLabel
} from './menu/utils'

export interface MenuBarProps {
  media: MediaMenuProps
  video: VideoMenuProps
  audio: AudioMenuProps
  subtitle: SubtitleMenuProps
  playback: PlaybackMenuProps
  vocabulary: VocabularyMenuProps
  onOpenOptions: () => void
  onOpenChange?: (open: boolean) => void
}

/** Compatibility contract for callers migrating to the named menu groups.
 * New production code should use MenuBarProps. */
type LegacyMenuBarProps = MediaMenuProps &
  VideoMenuProps &
  AudioMenuProps &
  SubtitleMenuProps &
  PlaybackMenuProps &
  VocabularyMenuProps & {
    onOpenOptions: () => void
    onOpenChange?: (open: boolean) => void
  }

type AnyMenuBarProps = MenuBarProps | LegacyMenuBarProps

export function isAnyMenuOpen(openMenu: string | null): boolean {
  return openMenu !== null
}

function isGroupedProps(props: AnyMenuBarProps): props is MenuBarProps {
  return 'media' in props
}

export default function MenuBar(props: AnyMenuBarProps): React.JSX.Element {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const grouped = isGroupedProps(props)
    ? props
    : {
        media: props,
        video: props,
        audio: props,
        subtitle: props,
        playback: props,
        vocabulary: props,
        onOpenOptions: props.onOpenOptions,
        onOpenChange: props.onOpenChange
      }
  const onOpenChange = grouped.onOpenChange

  useEffect(() => {
    onOpenChange?.(isAnyMenuOpen(openMenu))
  }, [openMenu, onOpenChange])
  useEffect(() => {
    if (!openMenu) return
    const close = (): void => setOpenMenu(null)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [openMenu])

  const toggle = (id: string): void => setOpenMenu((current) => (current === id ? null : id))
  const run = (action: () => void) => (): void => {
    action()
    setOpenMenu(null)
  }
  return (
    <nav id="menu-bar" onPointerDown={(event) => event.stopPropagation()}>
      <MediaMenu
        {...grouped.media}
        open={openMenu === 'media'}
        onToggle={() => toggle('media')}
        run={run}
      />
      <VideoMenu
        {...grouped.video}
        open={openMenu === 'video'}
        onToggle={() => toggle('video')}
        run={run}
      />
      <AudioMenu
        {...grouped.audio}
        open={openMenu === 'audio'}
        onToggle={() => toggle('audio')}
        run={run}
      />
      <SubtitleMenu
        {...grouped.subtitle}
        open={openMenu === 'subtitle'}
        onToggle={() => toggle('subtitle')}
        run={run}
      />
      <PlaybackMenu
        {...grouped.playback}
        open={openMenu === 'playback'}
        onToggle={() => toggle('playback')}
        run={run}
      />
      <VocabularyMenu
        {...grouped.vocabulary}
        open={openMenu === 'vocabulary'}
        onToggle={() => toggle('vocabulary')}
        run={run}
      />
      <div className="menu">
        <button
          type="button"
          className="menu-title"
          id="menu-settings"
          onClick={run(grouped.onOpenOptions)}
        >
          Settings
        </button>
      </div>
    </nav>
  )
}
