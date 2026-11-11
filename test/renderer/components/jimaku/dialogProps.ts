import { vi } from 'vitest'
import type { JimakuSubtitlesDialogProps } from '@src/renderer/src/components/JimakuSubtitlesDialog'
import type {
  JimakuArchiveMembersResult,
  JimakuEntry,
  JimakuFileCandidate,
  JimakuFolderHint
} from '@src/shared/jimaku'
import type { JimakuControllerState } from '@src/renderer/src/state/jimakuController'

export const identity: NonNullable<JimakuControllerState['identity']> = {
  titleQuery: 'Show',
  season: 2,
  episode: 7,
  year: 2024,
  releaseGroup: 'Group',
  source: 'WEB-DL',
  unknowns: []
}

export const rememberedTitle: JimakuFolderHint = {
  entryId: 1,
  name: 'Show',
  category: 'anime',
  season: 2,
  updatedAt: 10
}

export function entry(id: number, name = 'Show', movie = false): JimakuEntry {
  return {
    id,
    name,
    japaneseName: 'ショー',
    englishName: 'The Show',
    flags: { anime: !movie, movie, external: false, unverified: false, adult: false }
  }
}

export function file(
  candidateId: string,
  name: string,
  overrides: Partial<JimakuFileCandidate> = {}
): JimakuFileCandidate {
  return {
    candidateId,
    entryId: 1,
    sourcePage: { entryId: 1, url: 'https://jimaku.cc/entry/1' },
    name,
    size: 2048,
    lastModified: '2026-09-09T00:00:00.000Z',
    format: name.endsWith('.zip') ? 'zip' : 'srt',
    status: 'eligible',
    reasons: [],
    ...overrides
  }
}

export function archive(): JimakuArchiveMembersResult {
  return {
    kind: 'archiveMembers',
    packageId: 'package-1',
    entryId: 1,
    sourcePage: { entryId: 1, url: 'https://jimaku.cc/entry/1' },
    sourceFileName: 'Show-pack.zip',
    members: [
      {
        memberId: 'member-1',
        displayName: 'Show - 07.srt',
        format: 'srt',
        size: 100,
        inferredEpisode: 7,
        status: 'eligible',
        reasons: ['Episode 7']
      },
      {
        memberId: 'member-2',
        displayName: 'Show-special.srt',
        format: 'srt',
        size: 100,
        status: 'eligible',
        reasons: []
      }
    ]
  }
}

export function props(
  overrides: Partial<JimakuSubtitlesDialogProps> = {}
): JimakuSubtitlesDialogProps {
  const selectedEntry = entry(1)
  const firstFile = file('file-1', 'Show - 07.srt')
  return {
    open: true,
    phase: { kind: 'choosingTitle' },
    identity,
    category: 'all',
    entries: [],
    shownEntries: [],
    selectedEntry,
    files: [firstFile],
    shownFiles: [firstFile],
    showingMoreFiles: false,
    showingAllFiles: false,
    selectedFile: undefined,
    archive: undefined,
    selectedMember: undefined,
    currentVersionId: undefined,
    triedVersionIds: [],
    appliedVersionByItem: {},
    notice: undefined,
    canRevert: false,
    partial: false,
    failedCategories: [],
    onClose: vi.fn(),
    onEditIdentity: vi.fn(),
    onEditEpisode: vi.fn(),
    onSearch: vi.fn(),
    onChooseTitle: vi.fn(),
    onShowMoreFiles: vi.fn(),
    onShowAllFiles: vi.fn(),
    onChooseFile: vi.fn(),
    onChooseMember: vi.fn(),
    onCancelOperation: vi.fn(),
    onTryAnother: vi.fn(),
    onRevert: vi.fn(),
    onRefresh: vi.fn(),
    onOpenSourcePage: vi.fn(),
    onOpenSettings: vi.fn(),
    onAdjustTiming: vi.fn(),
    onLoadLocalFile: vi.fn(),
    ...overrides
  }
}
