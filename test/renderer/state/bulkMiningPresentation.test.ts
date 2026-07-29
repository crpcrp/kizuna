import { describe, expect, it } from 'vitest'
import type { BulkMiningPhase } from '@src/renderer/src/state/bulkMiningController'
import {
  hideBulkMiningToSidebar,
  reopenBulkMiningModal,
  type BulkMiningPresentation
} from '@src/renderer/src/state/bulkMiningPresentation'

const running: BulkMiningPhase = {
  kind: 'running',
  candidates: [],
  statuses: {},
  cancelling: false
}
const cancelling: BulkMiningPhase = { ...running, cancelling: true }
const done: BulkMiningPhase = {
  kind: 'done',
  candidates: [],
  statuses: {},
  summary: { added: 1, updated: 0, duplicate: 0, noEntry: 0, error: 0, cancelled: 0 }
}

describe('bulk mining presentation', () => {
  it('hides only an active modal and reopens the same sidebar presentation', () => {
    const controllerIdentity = { phase: running }
    const sidebar = hideBulkMiningToSidebar('modal', controllerIdentity.phase)

    expect(sidebar).toBe('sidebar')
    expect(controllerIdentity).toEqual({ phase: running })
    expect(reopenBulkMiningModal(sidebar)).toBe('modal')
  })

  it('allows hiding while cancellation is pending', () => {
    expect(hideBulkMiningToSidebar('modal', cancelling)).toBe('sidebar')
  })

  it('leaves invalid transitions and completed sidebar results unchanged', () => {
    const presentations: BulkMiningPresentation[] = ['closed', 'modal', 'sidebar']

    expect(hideBulkMiningToSidebar('closed', running)).toBe('closed')
    expect(hideBulkMiningToSidebar('sidebar', running)).toBe('sidebar')
    expect(hideBulkMiningToSidebar('modal', done)).toBe('modal')
    expect(hideBulkMiningToSidebar('sidebar', done)).toBe('sidebar')
    expect(reopenBulkMiningModal('closed')).toBe('closed')
    expect(reopenBulkMiningModal('modal')).toBe('modal')
    expect(
      presentations.map((presentation) => hideBulkMiningToSidebar(presentation, done))
    ).toEqual(presentations)
  })
})
