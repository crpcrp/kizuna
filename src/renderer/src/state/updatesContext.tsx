import { createContext, useContext } from 'react'
import { useUpdates, type UpdatesBridge, type UpdatesController } from './useUpdates'

const UpdatesContext = createContext<UpdatesController | null>(null)

/**
 * Shares the shell-owned updater with every surface below it. The application
 * shell mounts for splash, Options and the player alike, so the startup check
 * runs once per renderer session regardless of the start mode, and a dismissed
 * release stays dismissed across a surface switch.
 */
export function UpdatesProvider({
  value,
  children
}: {
  value: UpdatesController
  children: React.ReactNode
}): React.JSX.Element {
  return <UpdatesContext.Provider value={value}>{children}</UpdatesContext.Provider>
}

/**
 * The shell-owned controller when there is one. A surface rendered without the
 * provider (tests, SSR markup) falls back to its own controller so it keeps
 * working standalone.
 */
export function useSurfaceUpdates(bridge: UpdatesBridge): UpdatesController {
  const shared = useContext(UpdatesContext)
  const own = useUpdates(bridge, { active: shared === null })
  return shared ?? own
}
