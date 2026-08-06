import { describe, expect, it, vi } from 'vitest'
import { configureLinuxX11 } from '@src/main/windowEmbedding'

describe('configureLinuxX11', () => {
  it('forces Electron onto X11 on Linux', () => {
    const appendSwitch = vi.fn()

    configureLinuxX11({ commandLine: { appendSwitch } }, 'linux')

    expect(appendSwitch).toHaveBeenCalledWith('ozone-platform', 'x11')
  })

  it('does not change command-line switches on Windows', () => {
    const appendSwitch = vi.fn()

    configureLinuxX11({ commandLine: { appendSwitch } }, 'win32')

    expect(appendSwitch).not.toHaveBeenCalled()
  })

  it('does not change command-line switches on unsupported platforms', () => {
    const appendSwitch = vi.fn()

    configureLinuxX11({ commandLine: { appendSwitch } }, 'darwin')

    expect(appendSwitch).not.toHaveBeenCalled()
  })
})
