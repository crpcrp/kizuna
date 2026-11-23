import { useEffect, useState } from 'react'
import type { GrammarExamplesStatus } from '../../../shared/grammarExamples'
import type { KizunaApi } from '../../../shared/preloadApi'
import { errorMessage } from '../util/errorMessage'

export type TatoebaExamplesBridge = Pick<KizunaApi, 'grammarExamples' | 'appInfo'>

export interface TatoebaExamplesView {
  status: GrammarExamplesStatus | undefined
  /** Set after the user asks to download, so the size is shown before anything starts. */
  confirmBytes: number | undefined
  checkingSize: boolean
  sizeError: string | undefined
  onRequestDownload(): void
  onConfirmDownload(): void
  onDismissDownload(): void
  onUpdate(): void
  onRebuild(): void
  onCancel(): void
  onRemove(): void
  onOpenTatoeba(): void
  onOpenLicense(): void
}

/** Options state for the Tatoeba example database; network is used only on the user's clicks. */
export function useTatoebaExamples(bridge: TatoebaExamplesBridge): TatoebaExamplesView {
  const api = bridge.grammarExamples
  const [status, setStatus] = useState<GrammarExamplesStatus | undefined>()
  const [confirmBytes, setConfirmBytes] = useState<number | undefined>()
  const [checkingSize, setCheckingSize] = useState(false)
  const [sizeError, setSizeError] = useState<string | undefined>()

  useEffect(() => {
    let active = true
    const unsubscribe = api.onStatusChange((next) => {
      active = false
      setStatus(next)
    })
    void api.status().then(
      (initial) => {
        if (active) setStatus(initial)
      },
      () => {}
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [api])

  const ignore = (): void => {}
  return {
    status,
    confirmBytes,
    checkingSize,
    sizeError,
    onRequestDownload: () => {
      setCheckingSize(true)
      setSizeError(undefined)
      api
        .downloadSize()
        .then(setConfirmBytes, (error: unknown) => setSizeError(errorMessage(error)))
        .finally(() => setCheckingSize(false))
    },
    onConfirmDownload: () => {
      setConfirmBytes(undefined)
      api.download().catch(ignore)
    },
    onDismissDownload: () => setConfirmBytes(undefined),
    onUpdate: () => void api.download().catch(ignore),
    onRebuild: () => void api.rebuild().catch(ignore),
    onCancel: () => void api.cancel().catch(ignore),
    onRemove: () => void api.remove().catch(ignore),
    onOpenTatoeba: () => void bridge.appInfo.openLink('tatoeba').catch(ignore),
    onOpenLicense: () => void bridge.appInfo.openLink('tatoebaLicense').catch(ignore)
  }
}
