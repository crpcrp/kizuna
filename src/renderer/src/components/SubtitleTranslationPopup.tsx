import type {
  SidebarTranslationPopup,
  SidebarTranslationPopupPosition
} from '../state/sidebarTranslation'

export interface SubtitleTranslationPopupProps {
  popup: SidebarTranslationPopup
  position: SidebarTranslationPopupPosition | null
  popupRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
}

export default function SubtitleTranslationPopup({
  popup,
  position,
  popupRef,
  onClose
}: SubtitleTranslationPopupProps): React.JSX.Element {
  return (
    <div
      id="subtitle-sidebar-translate-popup"
      role="status"
      ref={popupRef}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0
      }}
    >
      <div className="subtitle-sidebar-translate-header">
        Copied to clipboard
        <button type="button" aria-label="Close translation" onClick={onClose}>
          ✕
        </button>
      </div>
      {popup.status === 'loading' && <p>Translating…</p>}
      {popup.status === 'done' && <p>{popup.text}</p>}
      {popup.status === 'error' && <p>Translation failed.</p>}
    </div>
  )
}
