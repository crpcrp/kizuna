import './TranslationPopup.css'
import type { TranslationPopup, TranslationPopupPosition } from '../state/sidebarTranslation'

export interface TranslationPopupProps {
  popup: TranslationPopup
  position: TranslationPopupPosition | null
  popupRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  id?: string
  title?: string
}

/** Shared loading/result/error presentation for subtitle and OCR translation. */
export default function TranslationPopup({
  popup,
  position,
  popupRef,
  onClose,
  id = 'subtitle-sidebar-translate-popup',
  title = 'Copied to clipboard'
}: TranslationPopupProps): React.JSX.Element {
  return (
    <div
      id={id}
      className="translation-popup"
      role="status"
      ref={popupRef}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0
      }}
    >
      <div className="translation-popup__header">
        {title}
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
