import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
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

describe('userDataDir', () => {
  it('places the data directory under the roaming profile, not the install folder', () => {
    expect(userDataDir('C:\\Users\\me\\AppData\\Roaming')).toBe(
      join('C:\\Users\\me\\AppData\\Roaming', USER_DATA_DIR_NAME)
    )
  })

  it('names the directory from the identity configuration', () => {
    expect(userDataDir('/root')).toBe(join('/root', USER_DATA_DIR_NAME))
  })
})

describe('screenshotsDir', () => {
  it('defaults to <Pictures>/<product name>', () => {
    expect(screenshotsDir('C:\\Users\\me\\Pictures')).toBe(
      join('C:\\Users\\me\\Pictures', PRODUCT_NAME)
    )
  })
})

describe('applyAppIdentity', () => {
  it('sets the app name, AppUserModelID, and user-data path', () => {
    const app = fakeApp({ appData: 'C:\\Users\\me\\AppData\\Roaming' })

    const resolved = applyAppIdentity(app)

    expect(app.name).toBe(PRODUCT_NAME)
    expect(app.appUserModelId).toBe(APP_ID)
    expect(resolved).toBe(join('C:\\Users\\me\\AppData\\Roaming', USER_DATA_DIR_NAME))
    expect(app.paths.userData).toBe(resolved)
  })

  it('overrides the package-name-derived default Electron would have used', () => {
    const app = fakeApp({
      appData: 'C:\\Users\\me\\AppData\\Roaming',
      userData: 'C:\\Users\\me\\AppData\\Roaming\\kizuna-electron-default'
    })

    applyAppIdentity(app)

    expect(app.paths.userData).toBe(join('C:\\Users\\me\\AppData\\Roaming', USER_DATA_DIR_NAME))
  })
})
