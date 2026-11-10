// Preload for the Game OCR frozen-frame window. That window renders text
// recognised from arbitrary screenshots, so it gets only the calls
// `src/renderer/src/gameOcr.tsx` makes — no settings writers, file readers,
// dictionary management, or playback control (see `KizunaGameOcrApi`).
import { contextBridge, ipcRenderer } from 'electron'
import {
  ANKI_CHANNELS,
  CLIPBOARD_CHANNELS,
  DICT_CHANNELS,
  GAME_OCR_CHANNELS,
  KNOWLEDGE_CHANNELS,
  MECAB_CHANNELS,
  PLAYER_SETTINGS_CHANNELS,
  TRANSLATE_CHANNELS
} from '../shared/ipcChannels'
import type { KizunaGameOcrApi } from '../shared/preloadApi'
import { subscribe } from './bridge'

const api = {
  gameOcr: {
    onFreeze: (cb) => subscribe(GAME_OCR_CHANNELS.freeze, cb),
    frozen: (value) => ipcRenderer.send(GAME_OCR_CHANNELS.frozen, value),
    captureBytes: (value) => ipcRenderer.send(GAME_OCR_CHANNELS.captureBytes, value),
    onDiscard: (cb) => subscribe(GAME_OCR_CHANNELS.discard, cb),
    onRecognitionState: (cb) => subscribe(GAME_OCR_CHANNELS.recognitionState, cb),
    onRegions: (cb) => subscribe(GAME_OCR_CHANNELS.regions, cb),
    regionsRendered: (value) => ipcRenderer.send(GAME_OCR_CHANNELS.regionsRendered, value),
    onCopySelection: (cb) => subscribe(GAME_OCR_CHANNELS.copySelection, cb),
    rendererReady: () => ipcRenderer.send(GAME_OCR_CHANNELS.rendererReady),
    close: () => ipcRenderer.send(GAME_OCR_CHANNELS.close)
  },
  mecab: {
    tokenizeBatch: (texts) => ipcRenderer.invoke(MECAB_CHANNELS.tokenizeBatch, texts)
  },
  dict: {
    lookup: (lemma, reading, freqDictId, sortMode, longestMatchCandidates, surface) =>
      ipcRenderer.invoke(
        DICT_CHANNELS.lookup,
        lemma,
        reading,
        freqDictId,
        sortMode,
        longestMatchCandidates,
        surface
      )
  },
  knowledge: {
    levelsFor: (lemmas) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.levelsFor, lemmas),
    detailsFor: (lemmas) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.detailsFor, lemmas)
  },
  anki: {
    getSettings: () => ipcRenderer.invoke(ANKI_CHANNELS.getSettings),
    findExisting: (token, word) => ipcRenderer.invoke(ANKI_CHANNELS.findExisting, token, word),
    addNote: (req) => ipcRenderer.invoke(ANKI_CHANNELS.addNote, req),
    openCard: (cardId) => ipcRenderer.invoke(ANKI_CHANNELS.openCard, cardId)
  },
  playerSettings: {
    getSettings: () => ipcRenderer.invoke(PLAYER_SETTINGS_CHANNELS.getSettings)
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(CLIPBOARD_CHANNELS.writeText, text)
  },
  translate: {
    translate: (text, requestId) =>
      ipcRenderer.invoke(TRANSLATE_CHANNELS.translate, { text, requestId }),
    cancel: (requestId) => ipcRenderer.send(TRANSLATE_CHANNELS.cancel, { requestId })
  }
} satisfies KizunaGameOcrApi

contextBridge.exposeInMainWorld('kizuna', api)
