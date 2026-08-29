// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AnkiTab from '@src/renderer/src/components/options/AnkiTab'
import { makeAnkiSettings } from '@test/harness/ankiFixtures'

afterEach(() => {
  cleanup()
  delete (window as unknown as { confirm?: unknown }).confirm
  vi.restoreAllMocks()
})

function renderTab(
  onSetupJlptField = vi.fn(async () => ({
    status: 'changed' as const,
    modelName: 'Kaishi 1.5k',
    addedField: true,
    updatedTemplates: ['Card 1']
  }))
): ReturnType<typeof render> {
  return render(
    <AnkiTab
      ankiSettings={makeAnkiSettings({ modelName: 'Kaishi 1.5k' })}
      ankiPing={async () => ({ ok: false })}
      onSetupJlptField={onSetupJlptField}
      onPreviewJlptBackfill={async () => ({
        status: 'preflight-failure',
        modelName: 'Kaishi 1.5k',
        message: 'Not configured'
      })}
      onApplyJlptBackfill={async () => ({ updated: 0, skipped: 0, failed: 0 })}
      onJlptBackfillProgress={() => () => undefined}
      onChangeAnkiSettings={vi.fn()}
    />
  )
}

describe('AnkiTab JLPT setup action', () => {
  it('does not call setup when the confirmation is declined', () => {
    const confirm = vi.fn(() => false)
    window.confirm = confirm
    const onSetupJlptField = vi.fn()
    renderTab(onSetupJlptField)

    fireEvent.click(screen.getByRole('button', { name: 'Set up JLPT field' }))

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('does not populate existing notes')
    )
    expect(onSetupJlptField).not.toHaveBeenCalled()
  })

  it('confirms, runs setup, and displays the structured success result', async () => {
    window.confirm = vi.fn(() => true)
    const onSetupJlptField = vi.fn(async () => ({
      status: 'changed' as const,
      modelName: 'Kaishi 1.5k',
      addedField: true,
      updatedTemplates: ['Card 1']
    }))
    renderTab(onSetupJlptField)

    fireEvent.click(screen.getByRole('button', { name: 'Set up JLPT field' }))

    await waitFor(() => expect(onSetupJlptField).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('JLPT field set up on Kaishi 1.5k.')).toBeTruthy()
  })
})
