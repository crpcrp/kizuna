import type { RecentMediaFile } from '../../../../shared/mediaHistory'
import { mediaFileBasename } from '../../../../shared/mediaHistory'
import { CommandItem, Menu, MenuItem } from './primitives'

export interface MediaMenuProps {
  hasFile?: boolean
  mediaOpening?: boolean
  recentFiles?: RecentMediaFile[]
  playlistOpen?: boolean
  hasPlaylist?: boolean
  onOpenFile: () => void
  onPrevFile?: () => void
  onNextFile?: () => void
  onOpenRecent?: (path: string) => void
  onClearRecentFiles?: () => void
  onTogglePlaylist?: () => void
  onAddFiles?: () => void
  onAddFolder?: () => void
  onSavePlaylist?: () => void
}
export function MediaMenu({
  open,
  onToggle,
  run,
  ...props
}: MediaMenuProps & {
  open: boolean
  onToggle: () => void
  run: (action: () => void) => () => void
}): React.JSX.Element {
  const {
    hasFile = false,
    mediaOpening = false,
    recentFiles = [],
    playlistOpen = false,
    hasPlaylist = false
  } = props
  return (
    <Menu id="media" label="Media" open={open} onToggle={onToggle}>
      <CommandItem
        label="Open file…"
        ariaLabel="Open file"
        id="open-file"
        disabled={mediaOpening}
        onClick={run(props.onOpenFile)}
      />
      <MenuItem
        label="Previous file"
        disabled={mediaOpening || !hasFile}
        onClick={run(() => props.onPrevFile?.())}
      />
      <MenuItem
        label="Next file"
        disabled={mediaOpening || !hasFile}
        onClick={run(() => props.onNextFile?.())}
      />
      <div className="menu-separator" />
      <div className="menu-section-label">Recent files</div>
      <div className="menu-recent-list">
        {recentFiles.length === 0 ? (
          <MenuItem label="No recent files" disabled />
        ) : (
          recentFiles.map((file) => (
            <CommandItem
              key={file.path}
              label={mediaFileBasename(file.path)}
              ariaLabel={file.path}
              title={file.path}
              disabled={mediaOpening}
              onClick={run(() => props.onOpenRecent?.(file.path))}
            />
          ))
        )}
      </div>
      <CommandItem
        label="Clear recent files"
        ariaLabel="Clear recent files"
        id="clear-recent-files"
        disabled={recentFiles.length === 0}
        onClick={run(() => props.onClearRecentFiles?.())}
      />
      <div className="menu-separator" />
      <MenuItem
        label="Show playlist"
        checked={playlistOpen}
        onClick={run(() => props.onTogglePlaylist?.())}
      />
      <CommandItem
        label="Add files…"
        ariaLabel="Add files to playlist"
        id="playlist-add-files"
        disabled={mediaOpening}
        onClick={run(() => props.onAddFiles?.())}
      />
      <CommandItem
        label="Add folder…"
        ariaLabel="Add folder to playlist"
        id="playlist-add-folder"
        disabled={mediaOpening}
        onClick={run(() => props.onAddFolder?.())}
      />
      <CommandItem
        label="Save playlist as .m3u…"
        ariaLabel="Save playlist as M3U"
        id="playlist-save"
        disabled={!hasPlaylist}
        onClick={run(() => props.onSavePlaylist?.())}
      />
    </Menu>
  )
}
