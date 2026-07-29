// IPC channel names shared between main and preload. Every channel string
// lives here so the two processes can never drift apart on a literal.

/** Custom window chrome controls (frameless window has no OS buttons). */
export const WINDOW_CONTROL_CHANNELS = {
  minimize: 'window:minimize',
  close: 'window:close',
  /** renderer→main: set fullscreen on/off (payload: boolean). */
  setFullscreen: 'window:setFullscreen',
  /** renderer→main: flip fullscreen. */
  toggleFullscreen: 'window:toggleFullscreen',
  /** main→renderer push: the window's fullscreen state changed (boolean). */
  fullscreenChanged: 'window:fullscreenChanged',
  /** renderer→main: resize the window's content area (payload: width, height). */
  setSize: 'window:setSize',
  /** renderer→main: set/clear always-on-top (payload: boolean). */
  setAlwaysOnTop: 'window:setAlwaysOnTop',
  /** renderer→main invoke: the window's current bounds `{x,y,width,height}`
   * (used by mini-player to save the pre-mini rectangle). */
  getBounds: 'window:getBounds',
  /** renderer→main invoke: set the window bounds. Payload is a
   * `SetWindowBoundsRequest`: an explicit rectangle, or a mini-player request
   * whose bottom-right corner main computes from the current display's work
   * area. Resolves the applied bounds (or null when no window resolves). */
  setBounds: 'window:setBounds'
} as const

/**
 * mpv playback bridge: command channels are renderer→main invoke/handle;
 * observation channels are main→renderer pushes (mpv property observers).
 */
export const PLAYER_CHANNELS = {
  load: 'player:load',
  setPause: 'player:setPause',
  seek: 'player:seek',
  setVolume: 'player:setVolume',
  setSpeed: 'player:setSpeed',
  setMuted: 'player:setMuted',
  setAudioDelay: 'player:setAudioDelay',
  setAudioTrack: 'player:setAudioTrack',
  /** renderer→main: read mpv's `track-list` (audio/subtitle streams) for the
   * URL path, where ffprobe never runs. */
  getTrackList: 'player:getTrackList',
  /** renderer→main: read mpv's `video-params` resolution for the URL path,
   *  where ffprobe never runs. */
  getVideoDimensions: 'player:getVideoDimensions',
  /** renderer→main: abort an in-flight `player:load` (stream timeout hedge or
   * user Cancel); triggers mpv `stop` and rejects the pending load. */
  cancelLoad: 'player:cancelLoad',
  /** renderer→main: read mpv's `audio-device-list` for the Audio > Device menu. */
  getAudioDevices: 'player:getAudioDevices',
  /** renderer→main: switch the active output device live (payload: device name). */
  setAudioDevice: 'player:setAudioDevice',
  /** renderer→main: toggle the dynaudnorm loudness filter (payload: boolean). */
  setLoudnessNorm: 'player:setLoudnessNorm',
  /** renderer→main: select the safe yt-dlp format policy for the next URL load. */
  setYtdlpQuality: 'player:setYtdlpQuality',
  /** renderer→main: set/clear the native A–B loop (payload: a, b in seconds or null). */
  setAbLoop: 'player:setAbLoop',
  setVideoMargins: 'player:setVideoMargins',
  /** renderer→main: apply the whole video-adjustments block (equalizer values,
   * rotate, deinterlace) in one call; the bridge fans it out to mpv properties. */
  setVideoAdjustments: 'player:setVideoAdjustments',
  /** renderer→main: advance one frame then pause (mpv `frame-step`). */
  frameStep: 'player:frameStep',
  /** renderer→main: step back one frame then pause (mpv `frame-back-step`). */
  frameBackStep: 'player:frameBackStep',
  /** renderer→main: capture the current frame to a PNG; resolves the saved path. */
  screenshot: 'player:screenshot',
  /** renderer→main: capture the current frame as raw base64 PNG data for the
   * Anki picture flow; resolves null when no frame could be captured. Nothing
   * is written to the user's screenshot folder. */
  captureFrame: 'player:captureFrame',
  timePos: 'player:timePos',
  duration: 'player:duration',
  eofReached: 'player:eofReached',
  /** main→renderer push: mpv's pause property changed (boolean). The renderer's
   * authoritative pause state — mpv self-pauses (frame-step, EOF with
   * keep-open) that the renderer never commanded arrive through here. */
  pause: 'player:pause',
  /** main→renderer push: a system media surface (a keyboard media key or a
   * taskbar thumbnail-toolbar button) was activated. Payload is a
   * `MediaKeyCommand` (`'playPause' | 'next' | 'prev' | 'stop'`); the renderer
   * routes it through the same handlers the in-window keys use. */
  mediaKey: 'player:mediaKey'
} as const

/**
 * Media/file-selection bridge: renderer→main invoke/handle channels for
 * picking a file, enumerating its ffprobe tracks, and loading a subtitle
 * stream's cues.
 */
export const MEDIA_CHANNELS = {
  openFile: 'media:openFile',
  /** Multi-select open-file dialog (Media > "Add files…"): resolves the chosen
   * paths (empty when cancelled) so several files can be queued at once. */
  openFiles: 'media:openFiles',
  /** Directory-picker (Media > "Add folder…"): resolves every video in the
   * chosen folder, naturally sorted (empty when cancelled). */
  openFolder: 'media:openFolder',
  /** Reads an `.m3u`/`.m3u8` file into absolute media paths (relative entries
   * resolved against the playlist file's folder). */
  readPlaylist: 'media:readPlaylist',
  /** Save-file dialog for exporting the queue as `.m3u`; writes the paths and
   * resolves the saved file path (undefined when cancelled). */
  savePlaylist: 'media:savePlaylist',
  /** Open-file dialog filtered to subtitle files (Subtitle menu > "Load
   * subtitle file…"); the chosen path then goes through loadExternalSubtitle. */
  openSubtitleFile: 'media:openSubtitleFile',
  enumerateTracks: 'media:enumerateTracks',
  loadSubtitle: 'media:loadSubtitle',
  /** Reads a standalone subtitle file (dropped or picked) into cues — no
   * ffmpeg, the parsers read the file directly. */
  loadExternalSubtitle: 'media:loadExternalSubtitle',
  /** Native pixel resolution of the file's video stream, for the Video
   * menu's size presets (undefined if there's no video stream). */
  getVideoDimensions: 'media:getVideoDimensions',
  /** Chapter markers/list metadata for the loaded media. */
  getChapters: 'media:getChapters',
  /** Natural-sorted previous/next video paths in the same folder. */
  folderNeighbors: 'media:folderNeighbors',
  /** Seekbar hover thumbnail: `(path, timeSec, durationSec)` → a base64
   * `data:image/jpeg` preview for the hovered time, or null when unavailable
   * (short/unknown duration, ffmpeg failure). The renderer can't read arbitrary
   * `file://` paths, so main returns the encoded image inline. */
  thumbnail: 'media:thumbnail'
} as const

/**
 * Media-history bridge: renderer-to-main commands for reading and mutating
 * durable media history. Progress recording remains main-owned by the player
 * bridge and is intentionally not exposed here.
 */
export const MEDIA_HISTORY_CHANNELS = {
  getRecentFiles: 'mediaHistory:getRecentFiles',
  getPlaybackHistory: 'mediaHistory:getPlaybackHistory',
  removeRecentFile: 'mediaHistory:removeRecentFile',
  clearRecentFiles: 'mediaHistory:clearRecentFiles',
  checkFileAvailability: 'mediaHistory:checkFileAvailability',
  setAudioTrack: 'mediaHistory:setAudioTrack',
  setSubtitleTrack: 'mediaHistory:setSubtitleTrack'
} as const

/** File-association launch bridge: main pushes explicit paths after the renderer subscribes. */
export const LAUNCH_CHANNELS = {
  openPath: 'launch:openPath',
  rendererReady: 'launch:rendererReady',
  /** main→renderer push: a queued launch file couldn't be opened because the
   * playback engine failed to start (payload: sanitized message string). */
  error: 'launch:error'
} as const

/**
 * MeCab tokenization bridge: renderer→main invoke/handle channels for
 * tokenizing text, listing available dictionaries, and switching the active
 * dictionary (persisted via the B3 settings store).
 */
export const MECAB_CHANNELS = {
  tokenize: 'mecab:tokenize',
  /** Tokenize many texts in one round-trip (e.g. every cue of a track for the
   * subtitle sidebar / report); returns one Token[] per input text, in order. */
  tokenizeBatch: 'mecab:tokenizeBatch',
  listDicts: 'mecab:listDicts',
  selectDict: 'mecab:selectDict',
  currentDict: 'mecab:currentDict'
} as const

/**
 * Yomitan dictionary bridge: renderer→main invoke/handle channels for
 * importing a dictionary zip, looking up a term, listing installed
 * dictionaries, enabling/disabling one, reordering their priority, and
 * removing one, or marking one as a fallback-only dictionary.
 */
export const DICT_CHANNELS = {
  importDict: 'dict:importDict',
  lookup: 'dict:lookup',
  listDicts: 'dict:listDicts',
  setEnabled: 'dict:setEnabled',
  setFallbackOnly: 'dict:setFallbackOnly',
  reorder: 'dict:reorder',
  remove: 'dict:remove',
  /** main→renderer push: periodic { done, total } while importDict runs. */
  importProgress: 'dict:importProgress'
} as const

/**
 * AnkiConnect bridge: renderer→main invoke/handle channels for testing the
 * connection, populating Options selects (decks/models/fields), adding a
 * note from the WordPopup, and reading/writing the `anki` settings block.
 */
export const ANKI_CHANNELS = {
  ping: 'anki:ping',
  deckNames: 'anki:deckNames',
  modelNames: 'anki:modelNames',
  modelFieldNames: 'anki:modelFieldNames',
  addNote: 'anki:addNote',
  findExisting: 'anki:findExisting',
  findTargetDeckMembership: 'anki:findTargetDeckMembership',
  openCard: 'anki:openCard',
  getSettings: 'anki:getSettings',
  setSettings: 'anki:setSettings'
} as const

/**
 * Knowledge bridge: renderer→main invoke/handle channels for querying known-
 * word levels, triggering a WaniKani/Anki sync, reading sync status, and
 * reading/writing the `knowledge` settings block (WaniKani token encrypted at
 * rest, see knowledgeBridge.ts). `syncIfStale` is not a channel — it runs
 * once from index.ts at startup, never from the renderer.
 */
export const KNOWLEDGE_CHANNELS = {
  levelsFor: 'knowledge:levelsFor',
  detailsFor: 'knowledge:detailsFor',
  sync: 'knowledge:sync',
  syncStatus: 'knowledge:syncStatus',
  getSettings: 'knowledge:getSettings',
  setSettings: 'knowledge:setSettings'
} as const

/**
 * Player-settings bridge: renderer→main invoke/handle channels for reading/
 * writing the `player` settings block (keybindings, skip amount, popup and
 * subtitle display settings — the Options menu's contents). Persisted to
 * settings.json alongside anki/knowledge instead of the renderer's
 * localStorage, which is scoped to the dev-server's origin/port.
 */
export const PLAYER_SETTINGS_CHANNELS = {
  getSettings: 'playerSettings:getSettings',
  setSettings: 'playerSettings:setSettings',
  /** renderer→main: create (if needed) and reveal Kizuna's mpv config folder
   * in the OS file manager (Options → Playback → "Open mpv config folder"). */
  openMpvConfigDir: 'playerSettings:openMpvConfigDir'
} as const

/**
 * URL-subtitle bridge (yt-dlp): renderer→main invoke channels to enumerate the
 * provided/auto subtitle tracks of the active extractor URL and acquire one
 * normalized track, plus a fire-and-forget cancel. Every input is validated in
 * main; no renderer-supplied flag, path, or URL reaches yt-dlp.
 */
export const URL_SUBTITLE_CHANNELS = {
  enumerate: 'urlSubtitles:enumerate',
  acquire: 'urlSubtitles:acquire',
  cancel: 'urlSubtitles:cancel'
} as const

/**
 * Integration-status bridge: one read-only query behind the Options dialog's
 * "Setup & integrations" tab, reporting whether each optional bundled binary
 * exists on disk. Diagnostics only — nothing here installs or configures.
 */
export const INTEGRATION_CHANNELS = {
  binaryStatus: 'integration:binaryStatus'
} as const

/** Clipboard bridge: renderer-to-main writes through Electron's clipboard
 * implementation rather than browser clipboard permissions. */
export const CLIPBOARD_CHANNELS = {
  writeText: 'clipboard:writeText'
} as const

/** Translation bridge: renderer requests are forwarded to the configured
 * main-process translator so the renderer never performs network access. */
export const TRANSLATE_CHANNELS = {
  translate: 'translate:translate',
  cancel: 'translate:cancel'
} as const
