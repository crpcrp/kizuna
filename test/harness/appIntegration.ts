import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, vi } from 'vitest'
import type { RecentMediaFile } from '@src/shared/mediaHistory'
import type { FakeKizunaApi } from './fakeKizunaApi'

// Shared scaffolding for the rendered `App` integration tests: the media path
// they open, the recent-files list shape the bridge returns, the Media-menu
// open, and the teardown every one of them needs.

/** Media path the rendered `App` tests open unless they need a distinct one. */
export const EPISODE = 'C:\\Media\\Episode05.mkv'

/** Builds a newest-first recent-files list from the given paths. */
export function recent(...paths: string[]): RecentMediaFile[] {
  return paths.map((path, i) => ({ path, openedAt: paths.length - i }))
}

/** Opens a recent file through the Media menu and waits for its load. */
export async function openRecent(
  load: FakeKizunaApi['player']['load'],
  path: string = EPISODE
): Promise<void> {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Media' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Media' }))
  fireEvent.click(screen.getByRole('menuitem', { name: path }))
  await waitFor(() => expect(load).toHaveBeenCalledWith(path))
}

/**
 * Registers the standard teardown for a rendered `App` test file. Files with
 * extra state to restore add their own `afterEach` alongside this.
 */
export function installAppTeardown(): void {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
}
