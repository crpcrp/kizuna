// Window chrome
export const WINDOW_CONTROL_CHANNELS = {
  minimize: 'window:minimize',
  close: 'window:close',
  setFullscreen: 'window:setFullscreen',
  toggleFullscreen: 'window:toggleFullscreen',
  fullscreenChanged: 'window:fullscreenChanged',
  setSize: 'window:setSize',
  setAlwaysOnTop: 'window:setAlwaysOnTop',
  setShape: 'window:setShape',
  getBounds: 'window:getBounds',
  setBounds: 'window:setBounds'
} as const

// mpv playback
export const PLAYER_CHANNELS = {
  load: 'player:load',
  setPause: 'player:setPause',
  seek: 'player:seek',
  setVolume: 'player:setVolume',
  setSpeed: 'player:setSpeed',
  setMuted: 'player:setMuted',
  setAudioDelay: 'player:setAudioDelay',
  setAudioTrack: 'player:setAudioTrack',
  getAudioDevices: 'player:getAudioDevices',
  setAudioDevice: 'player:setAudioDevice',
  setLoudnessNorm: 'player:setLoudnessNorm',
  setAbLoop: 'player:setAbLoop',
  setVideoMargins: 'player:setVideoMargins',
  setVideoAdjustments: 'player:setVideoAdjustments',
  frameStep: 'player:frameStep',
  frameBackStep: 'player:frameBackStep',
  screenshot: 'player:screenshot',
  captureFrame: 'player:captureFrame',
  timePos: 'player:timePos',
  duration: 'player:duration',
  eofReached: 'player:eofReached',
  pause: 'player:pause',
  mediaKey: 'player:mediaKey'
} as const

// Media files and subtitles
export const MEDIA_CHANNELS = {
  openFile: 'media:openFile',
  openFiles: 'media:openFiles',
  openFolder: 'media:openFolder',
  readPlaylist: 'media:readPlaylist',
  savePlaylist: 'media:savePlaylist',
  openSubtitleFile: 'media:openSubtitleFile',
  enumerateTracks: 'media:enumerateTracks',
  loadSubtitle: 'media:loadSubtitle',
  loadExternalSubtitle: 'media:loadExternalSubtitle',
  getVideoDimensions: 'media:getVideoDimensions',
  getChapters: 'media:getChapters',
  folderNeighbors: 'media:folderNeighbors',
  thumbnail: 'media:thumbnail'
} as const

// Media history
export const MEDIA_HISTORY_CHANNELS = {
  getRecentFiles: 'mediaHistory:getRecentFiles',
  getPlaybackHistory: 'mediaHistory:getPlaybackHistory',
  removeRecentFile: 'mediaHistory:removeRecentFile',
  clearRecentFiles: 'mediaHistory:clearRecentFiles',
  checkFileAvailability: 'mediaHistory:checkFileAvailability',
  setAudioTrack: 'mediaHistory:setAudioTrack',
  setSubtitleTrack: 'mediaHistory:setSubtitleTrack',
  setSubtitleVersionOffset: 'mediaHistory:setSubtitleVersionOffset'
} as const

// File-association launches
export const LAUNCH_CHANNELS = {
  openPath: 'launch:openPath',
  rendererReady: 'launch:rendererReady',
  error: 'launch:error'
} as const

// Application surfaces
export const APP_SHELL_CHANNELS = {
  getSurface: 'appShell:getSurface',
  showSplash: 'appShell:showSplash',
  showPlayer: 'appShell:showPlayer',
  showOptions: 'appShell:showOptions',
  dismissOptions: 'appShell:dismissOptions',
  quit: 'appShell:quit',
  surfaceChanged: 'appShell:surfaceChanged'
} as const

// Game OCR frozen frame
export const GAME_OCR_CHANNELS = {
  getSettings: 'gameOcr:getSettings',
  setSettings: 'gameOcr:setSettings',
  getStatus: 'gameOcr:getStatus',
  start: 'gameOcr:start',
  stop: 'gameOcr:stop',
  retry: 'gameOcr:retry',
  statusChanged: 'gameOcr:statusChanged',
  freeze: 'gameOcr:freeze',
  frozen: 'gameOcr:frozen',
  captureBytes: 'gameOcr:captureBytes',
  discard: 'gameOcr:discard',
  recognitionState: 'gameOcr:recognitionState',
  regions: 'gameOcr:regions',
  copySelection: 'gameOcr:copySelection',
  close: 'gameOcr:close',
  rendererReady: 'gameOcr:rendererReady'
} as const

// MeCab tokenization
export const MECAB_CHANNELS = {
  tokenize: 'mecab:tokenize',
  tokenizeBatch: 'mecab:tokenizeBatch',
  listDicts: 'mecab:listDicts',
  selectDict: 'mecab:selectDict',
  currentDict: 'mecab:currentDict',
  openUserUnidicDir: 'mecab:openUserUnidicDir'
} as const

// Yomitan dictionaries
export const DICT_CHANNELS = {
  importDictFile: 'dict:importDictFile',
  lookup: 'dict:lookup',
  listDicts: 'dict:listDicts',
  setEnabled: 'dict:setEnabled',
  setFallbackOnly: 'dict:setFallbackOnly',
  reorder: 'dict:reorder',
  remove: 'dict:remove',
  importProgress: 'dict:importProgress'
} as const

// Tatoeba grammar examples
export const GRAMMAR_EXAMPLES_CHANNELS = {
  lookup: 'grammarExamples:lookup',
  status: 'grammarExamples:status',
  downloadSize: 'grammarExamples:downloadSize',
  download: 'grammarExamples:download',
  rebuild: 'grammarExamples:rebuild',
  cancel: 'grammarExamples:cancel',
  remove: 'grammarExamples:remove',
  openSentence: 'grammarExamples:openSentence',
  statusChanged: 'grammarExamples:statusChanged'
} as const

// AnkiConnect
export const ANKI_CHANNELS = {
  ping: 'anki:ping',
  deckNames: 'anki:deckNames',
  modelNames: 'anki:modelNames',
  modelFieldNames: 'anki:modelFieldNames',
  setupJlptField: 'anki:setupJlptField',
  previewJlptBackfill: 'anki:previewJlptBackfill',
  applyJlptBackfill: 'anki:applyJlptBackfill',
  jlptBackfillProgress: 'anki:jlptBackfillProgress',
  addNote: 'anki:addNote',
  findExisting: 'anki:findExisting',
  findTargetDeckMembership: 'anki:findTargetDeckMembership',
  openCard: 'anki:openCard',
  getSettings: 'anki:getSettings',
  setSettings: 'anki:setSettings'
} as const

// Vocabulary knowledge
export const KNOWLEDGE_CHANNELS = {
  levelsFor: 'knowledge:levelsFor',
  detailsFor: 'knowledge:detailsFor',
  jlptCoverageReport: 'knowledge:jlptCoverageReport',
  jlptUnknownItems: 'knowledge:jlptUnknownItems',
  sync: 'knowledge:sync',
  syncStatus: 'knowledge:syncStatus',
  getSettings: 'knowledge:getSettings',
  setSettings: 'knowledge:setSettings'
} as const

// Player settings
export const PLAYER_SETTINGS_CHANNELS = {
  getSettings: 'playerSettings:getSettings',
  setSettings: 'playerSettings:setSettings',
  openMpvConfigDir: 'playerSettings:openMpvConfigDir'
} as const

// Integration diagnostics
export const INTEGRATION_CHANNELS = {
  binaryStatus: 'integration:binaryStatus'
} as const

// Product information
export const APP_INFO_CHANNELS = {
  get: 'appInfo:get',
  openLink: 'appInfo:openLink',
  openNotices: 'appInfo:openNotices'
} as const

// Application updates
export const UPDATE_CHANNELS = {
  getState: 'update:getState',
  getSettings: 'update:getSettings',
  setSettings: 'update:setSettings',
  check: 'update:check',
  download: 'update:download',
  install: 'update:install',
  stateChanged: 'update:stateChanged'
} as const

// Clipboard
export const CLIPBOARD_CHANNELS = {
  writeText: 'clipboard:writeText'
} as const

// Translation
export const TRANSLATE_CHANNELS = {
  translate: 'translate:translate',
  cancel: 'translate:cancel',
  getSettings: 'translate:getSettings',
  setSettings: 'translate:setSettings'
} as const

// Jimaku subtitles
export const JIMAKU_CHANNELS = {
  getStatus: 'jimaku:getStatus',
  setApiKey: 'jimaku:setApiKey',
  clearApiKey: 'jimaku:clearApiKey',
  testConnection: 'jimaku:testConnection',
  getFolderHint: 'jimaku:getFolderHint',
  setFolderHint: 'jimaku:setFolderHint',
  clearFolderHint: 'jimaku:clearFolderHint',
  beginSession: 'jimaku:beginSession',
  searchTitles: 'jimaku:searchTitles',
  listFiles: 'jimaku:listFiles',
  prepareFile: 'jimaku:prepareFile',
  prepareArchiveMember: 'jimaku:prepareArchiveMember',
  cancelPending: 'jimaku:cancelPending',
  endSession: 'jimaku:endSession',
  openSourcePage: 'jimaku:openSourcePage',
  commitPreparedSubtitle: 'jimaku:commitPreparedSubtitle',
  exportActiveSubtitle: 'jimaku:exportActiveSubtitle'
} as const
