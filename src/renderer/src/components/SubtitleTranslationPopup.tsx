import TranslationPopup, { type TranslationPopupProps } from './TranslationPopup'

export type SubtitleTranslationPopupProps = Omit<TranslationPopupProps, 'id' | 'title'>

export default function SubtitleTranslationPopup({
  popup,
  position,
  popupRef,
  onClose
}: SubtitleTranslationPopupProps): React.JSX.Element {
  return <TranslationPopup {...{ popup, position, popupRef, onClose }} />
}
