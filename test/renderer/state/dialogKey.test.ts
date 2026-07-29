import { describe, expect, it } from 'vitest'
import { bulkMiningDialogCloseAction } from '@src/renderer/src/state/dialogKey'
import type { BulkMiningPhase } from '@src/renderer/src/state/bulkMiningController'

describe('bulkMiningDialogCloseAction', () => {
  it.each<BulkMiningPhase>([
    { kind: 'ready' } as BulkMiningPhase,
    { kind: 'running', cancelling: false } as BulkMiningPhase,
    { kind: 'running', cancelling: true } as BulkMiningPhase,
    { kind: 'done' } as BulkMiningPhase
  ])('destructively closes the $kind mining surface for Escape', (phase) => {
    expect(bulkMiningDialogCloseAction('escape', phase)).toBe('discard')
  })

  it.each<BulkMiningPhase>([
    { kind: 'ready' } as BulkMiningPhase,
    { kind: 'running', cancelling: false } as BulkMiningPhase,
    { kind: 'running', cancelling: true } as BulkMiningPhase,
    { kind: 'done' } as BulkMiningPhase
  ])('keeps the $kind mining surface open for backdrop and panel clicks', (phase) => {
    expect(bulkMiningDialogCloseAction('backdrop', phase)).toBe('none')
    expect(bulkMiningDialogCloseAction('panel', phase)).toBe('none')
  })
})
