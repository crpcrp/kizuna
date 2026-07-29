// A media-transport command originating from a system surface — a keyboard
// media key or a taskbar thumbnail-toolbar button — pushed main→renderer over
// `PLAYER_CHANNELS.mediaKey`. The renderer routes it through the same handlers
// the in-window keys use, so queue/folder-advance logic stays in one place.

export type MediaKeyCommand = 'playPause' | 'next' | 'prev' | 'stop'
