import { useCallback, useState } from 'react'
import type { AppSurface } from '../../shared/appShell'
import { AUTO_AUDIO_DEVICE } from '../../shared/audioDevice'
import type { KizunaApi } from '../../shared/preloadApi'
import OptionsMenu from './components/OptionsMenu'
import { buildOptionsMenuProps } from './state/optionsMenuProps'
import { useModifierTracking } from './state/useKeyboardShortcuts'
import { useOptionsController } from './state/useOptionsController'
import { useStandaloneKnowledgeOptions } from './state/useKnowledgeOptions'
import { errorMessage } from './util/errorMessage'

import './theme.css'

export interface OptionsSurfaceProps {
  bridge: KizunaApi
  /** Main-owned surface request. AppShell supplies the race-safe version. */
  onClose?: () => Promise<AppSurface>
}

const noop = (): void => undefined

/** Cold-start Options root: settings and integrations without the player tree. */
export default function OptionsSurface({
  bridge,
  onClose
}: OptionsSurfaceProps): React.JSX.Element {
  const [error, setError] = useState<string>()
  const reportError = useCallback((message: string): void => setError(message), [])
  const controller = useOptionsController({ bridge, reportError })
  useModifierTracking(controller.modifiers)
  const knowledge = useStandaloneKnowledgeOptions({
    bridge,
    dispatch: controller.dispatch,
    optionsData: controller.options.controller
  })

  const close = useCallback((): void => {
    setError(undefined)
    controller.options.closeDialog()
    void (async () => {
      try {
        const next = await (onClose ?? bridge.appShell.showSplash)()
        if (next !== 'splash') {
          setError(`Could not return to the splash screen (surface is ${next}).`)
        }
      } catch (closeError) {
        setError(errorMessage(closeError))
      }
    })()
  }, [bridge.appShell.showSplash, controller.options, onClose])

  const optionsMenu = buildOptionsMenuProps({
    open: true,
    settings: controller.state,
    dispatch: controller.dispatch,
    heldModifiers: controller.modifiers.held,
    data: controller.options.data,
    actions: controller.options.actions,
    onClose: close,
    onCategoryOpen: controller.options.onCategoryOpen,
    playback: {
      audioDevices: [],
      audioDeviceSelectionPending: false,
      selectedAudioDevice: AUTO_AUDIO_DEVICE,
      onSelectAudioDevice: noop,
      onAudioDevicesRequest: noop,
      loudnessNormalization: controller.state.loudnessNormalization,
      onToggleLoudnessNorm: noop,
      livePlayerAvailable: false
    },
    knowledge,
    updates: {
      settings: controller.updates.settings,
      onChangeCheckAutomatically: controller.updates.setCheckAutomatically
    },
    supportsGameOcr: controller.gameOcr.supported,
    gameOcr: controller.gameOcr.options
  })

  return (
    <div id="app" className="standalone-options-app">
      <OptionsMenu {...optionsMenu} error={error} />
    </div>
  )
}
