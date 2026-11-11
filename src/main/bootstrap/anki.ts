import { registerAnkiBridge } from '../ankiBridge'
import { execFfmpeg } from '../media/ffmpeg'
import { createAnkiService } from '../services/anki/service'
import { createSentenceAudioService } from '../services/anki/sentenceAudio'
import { httpFetch } from '../services/http'
import { tempFileFs, type BootstrapDeps } from './deps'

/**
 * Registers the anki IPC bridge (ping/deckNames/modelNames/modelFieldNames/
 * JLPT setup/backfill/addNote/getSettings/setSettings), backed by the shared settings store, the
 * global `fetch` boundary, and the bundled ffmpeg used to clip
 * sentence audio out of the loaded media file.
 */
export function startAnki(
  deps: Pick<BootstrapDeps, 'ipcMain' | 'settings' | 'paths' | 'sendToMain'> & {
    ffmpegPath: string
  }
): void {
  const ankiService = createAnkiService({
    settings: deps.settings,
    fetch: httpFetch,
    // Sentence audio is clipped from the loaded file with the same bundled
    // ffmpeg and executor the media bridge uses.
    sentenceAudio: createSentenceAudioService({
      exec: execFfmpeg,
      ffmpegPath: deps.ffmpegPath,
      tmpDir: () => deps.paths.temp,
      fs: tempFileFs
    })
  })
  registerAnkiBridge(deps.ipcMain, ankiService, deps.sendToMain)
}
