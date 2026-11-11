import { pathApiFor } from '../platformPath'

export interface AppPathInputs {
  /** `app.getPath('userData')`, after `applyAppIdentity`. */
  userData: string
  /** `app.getPath('temp')`. */
  temp: string
  /** `app.getPath('pictures')`. */
  pictures: string
  isPackaged: boolean
  /** `process.resourcesPath`. */
  resourcesPath: string
  /** `app.getAppPath()`. */
  appRoot: string
  /** The compiled main bundle's directory (`out/main`), i.e. `__dirname` in `index.ts`. */
  mainDir: string
  platform?: NodeJS.Platform
}

/** Every path the main process derives at startup, resolved once. */
export interface AppPaths {
  userData: string
  temp: string
  pictures: string
  isPackaged: boolean
  resourcesPath: string
  appRoot: string
  mainDir: string
  /** First-party assets (icons) ship next to the vendored binaries. */
  resourcesBaseDir: string
  iconsDir: string
  settingsFile: string
  playbackHistoryFile: string
  thumbnailCacheDir: string
  dictDb: string
  knowledgeDb: string
  jimakuCacheRoot: string
  /** electron-builder's package-type marker (absent for AppImage and unpackaged builds). */
  packageTypeFile: string
  appUpdateConfigFile: string
  preload: string
  gameOcrPreload: string
  rendererHtml: string
  gameOcrHtml: string
}

export function resolveAppPaths(inputs: AppPathInputs): AppPaths {
  const { join } = pathApiFor(inputs.platform)
  const { userData, resourcesPath, mainDir } = inputs
  const resourcesBaseDir = inputs.isPackaged ? resourcesPath : join(inputs.appRoot, 'resources')
  return {
    userData,
    temp: inputs.temp,
    pictures: inputs.pictures,
    isPackaged: inputs.isPackaged,
    resourcesPath,
    appRoot: inputs.appRoot,
    mainDir,
    resourcesBaseDir,
    iconsDir: join(resourcesBaseDir, 'icons'),
    settingsFile: join(userData, 'settings.json'),
    playbackHistoryFile: join(userData, 'playback-history.json'),
    thumbnailCacheDir: join(userData, 'thumbnails'),
    dictDb: join(userData, 'dict.db'),
    knowledgeDb: join(userData, 'knowledge.db'),
    jimakuCacheRoot: join(userData, 'jimaku'),
    packageTypeFile: join(resourcesPath, 'package-type'),
    appUpdateConfigFile: join(resourcesPath, 'app-update.yml'),
    preload: join(mainDir, '../preload/index.js'),
    gameOcrPreload: join(mainDir, '../preload/gameOcr.js'),
    rendererHtml: join(mainDir, '../renderer/index.html'),
    gameOcrHtml: join(mainDir, '../renderer/gameOcr.html')
  }
}
