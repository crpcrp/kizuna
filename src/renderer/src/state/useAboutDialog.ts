import { useCallback, useState } from 'react'
import type { AppInfo, AppInfoLink } from '../../../shared/appInfo'
import type { KizunaApi } from '../../../shared/preloadApi'

export type AboutDialogBridge = Pick<KizunaApi, 'appInfo'>

export interface UseAboutDialogInput {
  bridge: AboutDialogBridge
  reportError: (message: string) => void
}

export interface UseAboutDialogResult {
  open: boolean
  info: AppInfo | null
  noticeMessage: string | null
  openDialog(): void
  closeDialog(): void
  openLink(link: AppInfoLink): void
  openNotices(): void
}

/** Owns About data loading and the main-process actions behind its buttons. */
export function useAboutDialog({ bridge, reportError }: UseAboutDialogInput): UseAboutDialogResult {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)

  const openDialog = useCallback((): void => {
    setOpen(true)
    setInfo(null)
    setNoticeMessage(null)
    void bridge.appInfo.get().then(setInfo, () => reportError('Could not load About information.'))
  }, [bridge.appInfo, reportError])

  const closeDialog = useCallback((): void => setOpen(false), [])

  const openLink = useCallback(
    (link: AppInfoLink): void => {
      void bridge.appInfo.openLink(link).catch(() => reportError('Could not open the link.'))
    },
    [bridge.appInfo, reportError]
  )

  const openNotices = useCallback((): void => {
    setNoticeMessage(null)
    void bridge.appInfo.openNotices().then(
      (result) => {
        if (result.status !== 'opened') setNoticeMessage(result.message)
      },
      () => reportError('Could not open third-party notices.')
    )
  }, [bridge.appInfo, reportError])

  return { open, info, noticeMessage, openDialog, closeDialog, openLink, openNotices }
}
