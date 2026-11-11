// Remembered-title (folder hint) state.
import type {
  JimakuEntry,
  JimakuFolderHint,
  JimakuFolderHintInput
} from '../../../../shared/jimaku'
import type { JimakuVideoIdentity } from '../../../../shared/jimakuMatching'
import type { JimakuCore } from './core'
import type { JimakuController } from './types'

export type JimakuRememberedActions = Pick<
  JimakuController,
  'rememberTitle' | 'clearRememberedTitle'
>

export const copyFolderHint = (hint: JimakuFolderHint): JimakuFolderHint => ({ ...hint })

export const entryFromFolderHint = (hint: JimakuFolderHint): JimakuEntry => ({
  id: hint.entryId,
  name: hint.name,
  ...(hint.englishName ? { englishName: hint.englishName } : {}),
  ...(hint.japaneseName ? { japaneseName: hint.japaneseName } : {}),
  flags: {
    anime: hint.category === 'anime',
    movie: false,
    external: false,
    unverified: false,
    adult: false
  }
})

export const identityFromFolderHint = (
  identity: JimakuVideoIdentity,
  hint: JimakuFolderHint
): JimakuVideoIdentity => ({
  ...identity,
  titleQuery: hint.name,
  unknowns: identity.unknowns.filter((unknown) => unknown.field !== 'title')
})

export function createJimakuRemembered(core: JimakuCore): JimakuRememberedActions {
  const { getDeps, set, resetTitleChoice } = core

  const rememberTitle = async (remember: boolean): Promise<void> => {
    const path = core.state.mediaPath
    const generation = core.state.mediaGeneration
    const entry = core.state.selectedEntry
    const identity = core.state.identity
    if (!path || generation === undefined || !entry || !identity) return

    if (!remember) {
      const existing = core.state.rememberedTitle
      if (!existing) return
      try {
        await getDeps().jimaku.clearFolderHint(path, existing.season)
      } catch {
        return
      }
      if (
        core.state.mediaPath === path &&
        core.state.mediaGeneration === generation &&
        core.state.selectedEntry?.id === entry.id
      )
        set({ ...core.state, rememberedTitle: undefined })
      return
    }

    const input: JimakuFolderHintInput = {
      entryId: entry.id,
      name: entry.name,
      ...(entry.englishName ? { englishName: entry.englishName } : {}),
      ...(entry.japaneseName ? { japaneseName: entry.japaneseName } : {}),
      category: entry.flags.anime ? 'anime' : 'liveAction',
      ...(identity.season === undefined ? {} : { season: identity.season })
    }
    let saved: JimakuFolderHint
    try {
      saved = await getDeps().jimaku.setFolderHint(path, input)
    } catch {
      return
    }
    if (
      core.state.phase.kind !== 'idle' &&
      core.state.mediaPath === path &&
      core.state.mediaGeneration === generation &&
      core.state.selectedEntry?.id === entry.id
    )
      set({ ...core.state, rememberedTitle: copyFolderHint(saved) })
  }

  const clearRememberedTitle = async (): Promise<void> => {
    const path = core.state.mediaPath
    const generation = core.state.mediaGeneration
    const existing = core.state.rememberedTitle
    if (!path || generation === undefined || !existing) return
    try {
      await getDeps().jimaku.clearFolderHint(path, existing.season)
    } catch {
      return
    }
    if (
      core.state.phase.kind === 'idle' ||
      core.state.mediaPath !== path ||
      core.state.mediaGeneration !== generation ||
      core.state.rememberedTitle?.entryId !== existing.entryId
    )
      return
    resetTitleChoice()
  }

  return {
    rememberTitle,
    clearRememberedTitle
  }
}
