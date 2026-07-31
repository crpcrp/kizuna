import MenuBar, { type MenuBarProps } from '@src/renderer/src/components/MenuBar'
import type { AudioMenuProps } from '@src/renderer/src/components/menu/AudioMenu'
import type { MediaMenuProps } from '@src/renderer/src/components/menu/MediaMenu'
import type { PlaybackMenuProps } from '@src/renderer/src/components/menu/PlaybackMenu'
import type { SubtitleMenuProps } from '@src/renderer/src/components/menu/SubtitleMenu'
import type { VideoMenuProps } from '@src/renderer/src/components/menu/VideoMenu'
import type { VocabularyMenuProps } from '@src/renderer/src/components/menu/VocabularyMenu'

export type FlatMenuBarTestProps = MediaMenuProps &
  VideoMenuProps &
  AudioMenuProps &
  SubtitleMenuProps &
  PlaybackMenuProps &
  VocabularyMenuProps & {
    onOpenOptions: () => void
    onOpenChange?: (open: boolean) => void
  }

export function groupedMenuBarProps(props: FlatMenuBarTestProps): MenuBarProps {
  return {
    media: props,
    video: props,
    audio: props,
    subtitle: props,
    playback: props,
    vocabulary: props,
    onOpenOptions: props.onOpenOptions,
    onOpenChange: props.onOpenChange
  }
}

export function TestMenuBar(props: FlatMenuBarTestProps): React.JSX.Element {
  return <MenuBar {...groupedMenuBarProps(props)} />
}
