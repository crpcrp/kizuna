import type {
  JimakuArchiveMember,
  JimakuEntry,
  JimakuFileCandidate,
  JimakuSearchCategory
} from '../../../../shared/jimaku'
import type { JimakuVideoIdentity } from '../../../../shared/jimakuMatching'
import type { JimakuControllerNotice, JimakuControllerPhase } from '../../state/jimakuController'

export const CATEGORY_OPTIONS: readonly { value: JimakuSearchCategory; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'anime', label: 'Anime' },
  { value: 'liveAction', label: 'Live action' }
]

export function episodeText(identity: JimakuVideoIdentity | undefined): string {
  if (!identity) return ''
  if (identity.episodeRange) return `${identity.episodeRange.start}-${identity.episodeRange.end}`
  return identity.episode === undefined ? '' : String(identity.episode)
}

export function identityHints(identity: JimakuVideoIdentity | undefined): string[] {
  if (!identity) return []
  const hints: string[] = []
  if (identity.season !== undefined) hints.push(`Season ${identity.season}`)
  if (identity.year !== undefined) hints.push(`Year ${identity.year}`)
  if (identity.releaseGroup) hints.push(`Release group: ${identity.releaseGroup}`)
  if (identity.source) hints.push(`Source: ${identity.source}`)
  return hints
}

export function aliases(entry: JimakuEntry): { japanese?: string; english?: string } {
  return {
    ...(entry.japaneseName && entry.japaneseName !== entry.name
      ? { japanese: entry.japaneseName }
      : {}),
    ...(entry.englishName && entry.englishName !== entry.name ? { english: entry.englishName } : {})
  }
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return 'Size unknown'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

export function formatLabel(format: JimakuFileCandidate['format']): string {
  return format === 'unsupported' ? 'Unsupported format' : format.toUpperCase()
}

export function categoryLabel(category: JimakuSearchCategory): string {
  return CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? category
}

export function jimakuErrorText(
  phase: Extract<JimakuControllerPhase, { kind: 'error' }>,
  retryAt?: string,
  rememberedUnavailable = false
): string {
  if (phase.code === 'notConfigured') return 'Jimaku setup is required before searching subtitles.'
  if (phase.code === 'unauthorized') return 'The Jimaku API key is invalid. Update it in Settings.'
  if (phase.code === 'rateLimited') {
    if (retryAt) {
      const timestamp = new Date(retryAt)
      if (!Number.isNaN(timestamp.getTime())) {
        return `Jimaku is rate-limited. Try again after ${timestamp.toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit'
        })}.`
      }
    }
    return 'Jimaku is rate-limited. Try again later.'
  }
  if (phase.code === 'notFound' && phase.recovery === 'titles') {
    return 'No matching titles. Edit the title or category and search again.'
  }
  if (phase.code === 'notFound' && phase.recovery === 'files') {
    if (rememberedUnavailable) {
      return 'Remembered title is no longer available. Search for a title or clear the remembered title.'
    }
    return 'No usable subtitles were found for this title. Try another title or refresh results.'
  }
  if (phase.code === 'noMedia')
    return 'No video is open. You can load a local subtitle file instead.'
  if (phase.code === 'invalidSubtitle' || phase.code === 'unsupportedDownload') {
    return 'This subtitle cannot be used. Choose another file.'
  }
  if (
    phase.code === 'invalidArchive' ||
    phase.code === 'unsupportedArchive' ||
    phase.code === 'tooLarge'
  ) {
    return 'This archive cannot be used. Choose another file.'
  }
  if (phase.code === 'selection') return 'Kizuna could not load this subtitle. Choose another file.'
  if (phase.code === 'openExternalFailed') return 'Jimaku could not be opened. Try again.'
  if (phase.code === 'staleMedia') return 'The video changed. Close and reopen subtitle search.'
  if (phase.code === 'invalidRequest')
    return 'Check the title, category, and episode, then search again.'
  if (phase.code === 'storage')
    return 'The subtitle could not be saved. Choose another file or try again.'
  return 'Jimaku is temporarily unavailable. Try again.'
}

export function statusMessage(notice: JimakuControllerNotice | undefined): string | null {
  if (notice === 'applied') return 'Subtitle loaded.'
  if (notice === 'sameContent') return 'This subtitle is already in use.'
  if (notice === 'loadedButNotSaved')
    return 'Subtitle loaded, but the selection could not be saved.'
  return null
}

export function itemState(
  itemKey: string,
  currentVersionId: string | undefined,
  triedVersionIds: string[],
  appliedVersionByItem: Record<string, string>
): { inUse: boolean; previouslyTried: boolean } {
  const version = appliedVersionByItem[itemKey]
  return {
    inUse: version !== undefined && version === currentVersionId,
    previouslyTried:
      version !== undefined && version !== currentVersionId && triedVersionIds.includes(version)
  }
}

export function archiveMemberHint(member: JimakuArchiveMember): string {
  if (member.inferredEpisode !== undefined) return `Episode ${member.inferredEpisode}`
  if (member.inferredEpisodeRange) {
    return `Episodes ${member.inferredEpisodeRange.start}-${member.inferredEpisodeRange.end}`
  }
  return 'Timing unknown'
}
