import './MenuBar.css'
import { useEffect, useState } from 'react'
import { AudioMenu, type AudioMenuProps } from './menu/AudioMenu'
import { MediaMenu, type MediaMenuProps } from './menu/MediaMenu'
import { PlaybackMenu, type PlaybackMenuProps } from './menu/PlaybackMenu'
import { SubtitleMenu, type SubtitleMenuProps } from './menu/SubtitleMenu'
import { VideoMenu, type VideoMenuProps } from './menu/VideoMenu'
import { VocabularyMenu, type VocabularyMenuProps } from './menu/VocabularyMenu'
import { CommandItem, Menu } from './menu/primitives'

export interface MenuBarProps {
  media: MediaMenuProps
  video: VideoMenuProps
  audio: AudioMenuProps
  subtitle: SubtitleMenuProps
  playback: PlaybackMenuProps
  vocabulary: VocabularyMenuProps
  onOpenOptions: () => void
  onOpenAbout?: () => void
  onOpenChange?: (open: boolean) => void
  gameOcr?: {
    label: string
    disabled?: boolean
    onClick: () => void
  }
}

export function isAnyMenuOpen(openMenu: string | null): boolean {
  return openMenu !== null
}

export default function MenuBar({
  media,
  video,
  audio,
  subtitle,
  playback,
  vocabulary,
  onOpenOptions,
  onOpenAbout = () => {},
  onOpenChange,
  gameOcr
}: MenuBarProps): React.JSX.Element {
  const [openMenu, setOpenMenu] = useState<string | null>(null)

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
        {...media}
        open={openMenu === 'media'}
        onToggle={() => toggle('media')}
        run={run}
      />
      <VideoMenu
        {...video}
        open={openMenu === 'video'}
        onToggle={() => toggle('video')}
        run={run}
      />
      <AudioMenu
        {...audio}
        open={openMenu === 'audio'}
        onToggle={() => toggle('audio')}
        run={run}
      />
      <SubtitleMenu
        {...subtitle}
        open={openMenu === 'subtitle'}
        onToggle={() => toggle('subtitle')}
        run={run}
      />
      <PlaybackMenu
        {...playback}
        open={openMenu === 'playback'}
        onToggle={() => toggle('playback')}
        run={run}
      />
      <VocabularyMenu
        {...vocabulary}
        open={openMenu === 'vocabulary'}
        onToggle={() => toggle('vocabulary')}
        run={run}
      />
      <Menu
        id="settings"
        label="Settings"
        open={openMenu === 'settings'}
        onToggle={() => toggle('settings')}
      >
        {gameOcr && (
          <CommandItem
            label={gameOcr.label}
            ariaLabel={gameOcr.label}
            id="game-ocr-command"
            disabled={gameOcr.disabled}
            onClick={run(gameOcr.onClick)}
          />
        )}
        <CommandItem
          label="Options…"
          ariaLabel="Options"
          id="open-options"
          onClick={run(onOpenOptions)}
        />
        <CommandItem
          label="About Kizuna"
          ariaLabel="About Kizuna"
          id="open-about-kizuna"
          onClick={run(onOpenAbout)}
        />
      </Menu>
    </nav>
  )
}
