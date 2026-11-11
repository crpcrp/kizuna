import { describe, expect, it } from 'vitest'
import { resolveAppPaths } from '@src/main/bootstrap/paths'
import { PATH_PLATFORMS } from '@test/harness/platformPaths'

describe.each(PATH_PLATFORMS)('resolveAppPaths ($label)', (c) => {
  const resourcesPath = c.path.join(c.appDataDir, 'Programs', 'Kizuna', 'resources')
  const appRoot = c.path.join(c.mediaDir, 'kizuna')
  const mainDir = c.path.join(appRoot, 'out', 'main')
  const resolve = (isPackaged: boolean): ReturnType<typeof resolveAppPaths> =>
    resolveAppPaths({
      userData: c.userDataDir,
      temp: c.tempDir,
      pictures: c.picturesDir,
      isPackaged,
      resourcesPath,
      appRoot,
      mainDir,
      platform: c.platform
    })

  it('derives userData files and the Jimaku cache root once', () => {
    const paths = resolve(true)
    expect(paths.settingsFile).toBe(c.path.join(c.userDataDir, 'settings.json'))
    expect(paths.playbackHistoryFile).toBe(c.path.join(c.userDataDir, 'playback-history.json'))
    expect(paths.thumbnailCacheDir).toBe(c.path.join(c.userDataDir, 'thumbnails'))
    expect(paths.dictDb).toBe(c.path.join(c.userDataDir, 'dict.db'))
    expect(paths.knowledgeDb).toBe(c.path.join(c.userDataDir, 'knowledge.db'))
    expect(paths.jimakuCacheRoot).toBe(c.path.join(c.userDataDir, 'jimaku'))
  })

  it('places first-party icons under the packaged or development resources root', () => {
    expect(resolve(true).iconsDir).toBe(c.path.join(resourcesPath, 'icons'))
    expect(resolve(false).iconsDir).toBe(c.path.join(appRoot, 'resources', 'icons'))
  })

  it('resolves preload and renderer entries beside the main bundle', () => {
    const paths = resolve(true)
    expect(paths.preload).toBe(c.path.join(appRoot, 'out', 'preload', 'index.js'))
    expect(paths.gameOcrHtml).toBe(c.path.join(appRoot, 'out', 'renderer', 'gameOcr.html'))
  })
})
