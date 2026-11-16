export interface GameOcrSelection {
  text: string
  box: HTMLElement
  range: Range
}

/** Reads selected DOM text with explicit line breaks for browser consistency. */
export function selectedGameOcrText(selection: Selection | null): string {
  if (!selection || selection.rangeCount !== 1) return selection?.toString() ?? ''

  const range = selection.getRangeAt(0)
  const cloned = range.cloneContents()
  const text = textFromNode(cloned)
  return text || selection.toString()
}

// Require the whole selection inside one live OCR box to exclude stale or cross-box translation text.
export function readGameOcrSelection(selection: Selection | null): GameOcrSelection | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null

  const text = selectedGameOcrText(selection).trim()
  if (text.length === 0) return null

  const range = selection.getRangeAt(0)
  const startBox = boxForNode(range.startContainer)
  const endBox = boxForNode(range.endContainer)
  const commonBox = boxForNode(range.commonAncestorContainer)
  if (!startBox || startBox !== endBox || startBox !== commonBox) return null
  if (!startBox.isConnected || !document.documentElement.contains(startBox)) return null
  if (!isVisible(startBox)) return null
  if (
    !startBox.contains(range.startContainer) ||
    !startBox.contains(range.endContainer) ||
    !startBox.contains(range.commonAncestorContainer)
  ) {
    return null
  }

  return { text, box: startBox, range }
}

function boxForNode(node: Node): HTMLElement | null {
  let current: Node | null = node
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const box = (current as Element).closest<HTMLElement>('[data-game-ocr-box]')
      if (box) return box
    }
    current = current.parentNode
  }
  return null
}

function isVisible(box: HTMLElement): boolean {
  if (box.hidden || box.getAttribute('aria-hidden') === 'true') return false
  const style = window.getComputedStyle(box)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function textFromNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? ''
  if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR') return '\n'
  return [...node.childNodes].map(textFromNode).join('')
}
