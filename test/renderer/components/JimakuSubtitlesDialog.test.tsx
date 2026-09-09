// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import JimakuSubtitlesDialog, {
  type JimakuSubtitlesDialogProps
} from '@src/renderer/src/components/JimakuSubtitlesDialog'
import type {
  JimakuArchiveMembersResult,
  JimakuEntry,
  JimakuFileCandidate
} from '@src/shared/jimaku'
import type { JimakuControllerState } from '@src/renderer/src/state/jimakuController'

afterEach(cleanup)

const identity: NonNullable<JimakuControllerState['identity']> = {
  titleQuery: 'Show',
  season: 2,
  episode: 7,
  year: 2024,
  releaseGroup: 'Group',
  source: 'WEB-DL',
  unknowns: []
}

function entry(id: number, name = 'Show', movie = false): JimakuEntry {
  return {
    id,
    name,
    japaneseName: 'ショー',
    englishName: 'The Show',
    flags: { anime: !movie, movie, external: false, unverified: false, adult: false }
  }
}

function file(
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

function archive(): JimakuArchiveMembersResult {
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

function props(overrides: Partial<JimakuSubtitlesDialogProps> = {}): JimakuSubtitlesDialogProps {
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

describe('JimakuSubtitlesDialog title stage', () => {
  it('keeps editing local and submits only from Search or the form', () => {
    const dialog = props({
      selectedEntry: undefined,
      files: [],
      shownFiles: [],
      entries: [entry(1), entry(2, 'Another Show')],
      shownEntries: [entry(1), entry(2, 'Another Show')]
    })
    render(<JimakuSubtitlesDialog {...dialog} />)

    const query = screen.getByRole('textbox', { name: 'Title query' })
    fireEvent.change(query, { target: { value: 'Edited show' } })
    expect(dialog.onEditIdentity).toHaveBeenCalledWith({ titleQuery: 'Edited show' })
    expect(dialog.onSearch).not.toHaveBeenCalled()

    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), {
      target: { value: 'anime' }
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Episode' }), {
      target: { value: '8-9' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(dialog.onEditIdentity).toHaveBeenCalledWith({ category: 'anime' })
    expect(dialog.onEditEpisode).toHaveBeenCalledWith('8-9')
    expect(dialog.onSearch).toHaveBeenCalledOnce()

    expect(
      screen.getByText('Season 2 · Year 2024 · Release group: Group · Source: WEB-DL')
    ).toBeTruthy()
    expect(screen.getByText('Show', { exact: true })).toBeTruthy()
    expect(screen.getByText('Another Show', { exact: true })).toBeTruthy()
  })

  it('shows partial results and retries without hiding available works', () => {
    const dialog = props({
      selectedEntry: undefined,
      files: [],
      shownFiles: [],
      entries: [entry(1)],
      shownEntries: [entry(1)],
      partial: true,
      failedCategories: ['liveAction']
    })
    render(<JimakuSubtitlesDialog {...dialog} />)

    expect(screen.getByText(/Live action could not be searched/)).toBeTruthy()
    expect(screen.getByText('Show', { exact: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(dialog.onRefresh).toHaveBeenCalledOnce()
  })
})

describe('JimakuSubtitlesDialog file and archive stages', () => {
  it('renders ranked file clues, pagination, disabled exclusions, and delegated actions', () => {
    const first = file('first', 'Show - 07.srt', {
      reasons: ['Same episode', 'Timing unknown', 'Same release group']
    })
    const second = file('second', 'Show - 08.ass', { format: 'ass', size: Number.NaN })
    const third = file('third', 'Show - 09.zip', { format: 'zip' })
    const fourth = file('fourth', 'Show - 10.ssa', { format: 'ssa' })
    const fifth = file('fifth', 'Show - 11.srt', { reasons: ['Signs/songs only'] })
    const excluded = file('excluded', 'Show - 12.srt', {
      status: 'excluded',
      reasons: ['Different episode', 'Foreign-only subtitle']
    })
    const dialog = props({
      phase: { kind: 'choosingFile' },
      files: [first, second, third, fourth, fifth, excluded],
      shownFiles: [first, second, third, fourth, fifth]
    })
    render(<JimakuSubtitlesDialog {...dialog} />)

    expect(screen.getByText('Same episode')).toBeTruthy()
    expect(screen.getByText('Timing unknown')).toBeTruthy()
    expect(screen.getByText('Same release group')).toBeTruthy()
    expect(screen.getAllByText('2.0 KiB')).toHaveLength(4)
    expect(screen.getByText('Size unknown')).toBeTruthy()
    expect(screen.getAllByText('Signs/songs only')).toHaveLength(2)
    expect(screen.queryByText('Different episode')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show all files' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh results' })).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Download and use' })[0])
    expect(dialog.onChooseFile).toHaveBeenCalledWith('first')
    fireEvent.click(screen.getByRole('button', { name: 'Open Show - 07.srt source on Jimaku' }))
    expect(dialog.onOpenSourcePage).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: 'Show all files' }))
    expect(dialog.onShowAllFiles).toHaveBeenCalledOnce()
  })

  it('uses Open on Jimaku for externally hosted titles and never offers a broken download', () => {
    const external = entry(1)
    external.flags.external = true
    const dialog = props({
      phase: { kind: 'choosingFile' },
      selectedEntry: external,
      files: [file('external', 'Show - 07.srt')],
      shownFiles: [file('external', 'Show - 07.srt')]
    })
    render(<JimakuSubtitlesDialog {...dialog} />)

    expect(screen.queryByRole('button', { name: 'Download and use' })).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Open on Jimaku' })[1])
    expect(dialog.onOpenSourcePage).toHaveBeenCalledWith(1)
  })

  it('requires an explicit archive member choice and shows timing hints', () => {
    const dialog = props({
      phase: { kind: 'choosingArchiveMember' },
      archive: archive(),
      selectedFile: file('zip', 'Show-pack.zip', { format: 'zip' }),
      showingAllFiles: true
    })
    render(<JimakuSubtitlesDialog {...dialog} />)

    expect(screen.getByText(/will not guess between ambiguous members/)).toBeTruthy()
    expect(screen.getAllByText('Episode 7')).toHaveLength(2)
    expect(screen.getByText('Timing unknown')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Download and use' })[0])
    expect(dialog.onChooseMember).toHaveBeenCalledWith('member-1')
  })
})

describe('JimakuSubtitlesDialog states and actions', () => {
  it('renders success actions and distinct status notices', () => {
    const dialog = props({
      phase: { kind: 'choosingFile' },
      notice: 'sameContent',
      currentVersionId: 'version-1',
      appliedVersionByItem: { 'file-1': 'version-1' },
      canRevert: true
    })
    render(<JimakuSubtitlesDialog {...dialog} />)

    expect(screen.getByRole('status').textContent).toContain('already in use')
    expect(screen.getByText('In use')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Adjust timing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Try another' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revert to previous subtitles' }))
    expect(dialog.onAdjustTiming).toHaveBeenCalledOnce()
    expect(dialog.onTryAnother).toHaveBeenCalledOnce()
    expect(dialog.onRevert).toHaveBeenCalledOnce()
  })

  it('maps busy, setup, actionable errors, cancellation, and Escape to callbacks', () => {
    const dialog = props({ phase: { kind: 'searchingTitles' } })
    const { rerender } = render(<JimakuSubtitlesDialog {...dialog} />)
    expect(screen.getByRole('status').textContent).toContain('Searching Jimaku titles')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(dialog.onCancelOperation).toHaveBeenCalledOnce()

    rerender(<JimakuSubtitlesDialog {...dialog} phase={{ kind: 'setupRequired' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(dialog.onOpenSettings).toHaveBeenCalledOnce()

    rerender(
      <JimakuSubtitlesDialog
        {...dialog}
        phase={{ kind: 'error', code: 'notFound', recovery: 'titles' }}
      />
    )
    expect(screen.getByRole('alert').textContent).toContain('Edit the title or category')
    fireEvent.click(screen.getByRole('button', { name: 'Edit title or category' }))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Title query' }))

    rerender(
      <JimakuSubtitlesDialog
        {...dialog}
        phase={{ kind: 'error', code: 'network', recovery: 'files' }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(dialog.onRefresh).toHaveBeenCalledOnce()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(dialog.onClose).toHaveBeenCalledOnce()
  })

  it('disables episode filtering for a movie and keeps local fallback delegated', () => {
    const movie = entry(2, 'Movie', true)
    const dialog = props({
      phase: { kind: 'choosingFile' },
      selectedEntry: movie,
      onLoadLocalFile: vi.fn()
    })
    render(<JimakuSubtitlesDialog {...dialog} />)

    expect(screen.getByRole('textbox', { name: 'Episode' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Movies do not use episode filtering.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Load local file…' }))
    expect(dialog.onLoadLocalFile).toHaveBeenCalledOnce()
  })
})
