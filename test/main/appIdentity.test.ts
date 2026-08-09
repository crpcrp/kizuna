import { describe, it, expect } from 'vitest'
import { PATH_PLATFORMS } from '@test/harness/platformPaths'
import {
  applyAppIdentity,
  screenshotsDir,
  userDataDir,
  type AppIdentityTarget
} from '@src/main/appIdentity'
import { APP_ID, PRODUCT_NAME, USER_DATA_DIR_NAME } from '@src/shared/appIdentity'

/** Records what the real Electron `app` would have been told. */
function fakeApp(paths: Record<string, string>): AppIdentityTarget & {
  name: string | null
  appUserModelId: string | null
  paths: Record<string, string>
} {
  return {
    name: null,
    appUserModelId: null,
    paths: { ...paths },
    setName(name) {
      this.name = name
    },
    setAppUserModelId(id) {
      this.appUserModelId = id
    },
    getPath(key) {
      return this.paths[key]
    },
    setPath(key, value) {
      this.paths[key] = value
    }
  }
}

// Both platform variants are asserted on either host: each case builds its
// expectation with its own path API, so a Linux runner still proves that a
// Windows appData root produces a backslash-joined user-data directory.
describe.each(PATH_PLATFORMS)(
  'app identity paths on $label',
  ({ platform, path, appDataDir: appData, picturesDir: pictures }) => {
    it('places the data directory under the per-user profile, not the install folder', () => {
      expect(userDataDir(appData, platform)).toBe(path.join(appData, USER_DATA_DIR_NAME))
    })

    it('defaults screenshots to <Pictures>/<product name>', () => {
      expect(screenshotsDir(pictures, platform)).toBe(path.join(pictures, PRODUCT_NAME))
    })

    it('sets the app name, AppUserModelID, and user-data path', () => {
      const app = fakeApp({ appData })

      const resolved = applyAppIdentity(app, platform)

      expect(app.name).toBe(PRODUCT_NAME)
      expect(app.appUserModelId).toBe(APP_ID)
      expect(resolved).toBe(path.join(appData, USER_DATA_DIR_NAME))
      expect(app.paths.userData).toBe(resolved)
    })

    it('overrides the package-name-derived default Electron would have used', () => {
      const app = fakeApp({
        appData,
        userData: path.join(appData, 'kizuna-electron-default')
      })

      applyAppIdentity(app, platform)

      expect(app.paths.userData).toBe(path.join(appData, USER_DATA_DIR_NAME))
    })
  }
)

describe('userDataDir', () => {
  it('names the directory from the identity configuration', () => {
    expect(userDataDir('/root', 'linux')).toBe(`/root/${USER_DATA_DIR_NAME}`)
  })
})
