import { observeExamDocuments } from '@/lib/exam-mode-documents'

function hasSelectedText(targetDocument: Document, target: Node, root: Node): boolean {
  const element = target.nodeType === 1 ? target as Element : target.parentElement
  if (element?.tagName === 'INPUT' || element?.tagName === 'TEXTAREA') {
    const field = element as HTMLInputElement | HTMLTextAreaElement
    const start = field.selectionStart
    const end = field.selectionEnd
    return start !== null && end !== null && end > start && field.value.slice(start, end).trim().length > 0
  }

  const selection = targetDocument.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index)
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return false
  }
  // Inspect only whether selected text is nonblank; never retain or report its contents.
  return selection.toString().trim().length > 0
}

/** Report selected-text native menu intent without blocking the menu or collecting text. */
export function listenForExamContextMenus(
  examWindow: Window,
  examRoot: HTMLElement,
  callbacks: { onContextMenu: (hasSelection: boolean) => void; onCancel: () => void }
): () => void {
  return observeExamDocuments(examWindow, (targetWindow, targetDocument) => {
    function isInsideExam(target: Node): boolean {
      if (targetDocument === examRoot.ownerDocument) return examRoot.contains(target)
      try {
        let currentWindow = targetWindow
        while (currentWindow !== examWindow) {
          const frame = currentWindow.frameElement
          if (!frame) return false
          if (frame.ownerDocument === examRoot.ownerDocument) return examRoot.contains(frame)
          currentWindow = currentWindow.parent
        }
      } catch {
        // A reference can become inaccessible or leave the exam after attachment.
      }
      return false
    }

    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as Node | null
      const selectionRoot = targetDocument === examRoot.ownerDocument ? examRoot : targetDocument
      callbacks.onContextMenu(Boolean(
        target?.nodeType && isInsideExam(target) && hasSelectedText(targetDocument, target, selectionRoot)
      ))
    }
    const onCancel = () => callbacks.onCancel()
    targetWindow.addEventListener('contextmenu', onContextMenu, true)
    targetWindow.addEventListener('pointerdown', onCancel, true)
    targetWindow.addEventListener('keydown', onCancel, true)
    return () => {
      targetWindow.removeEventListener('contextmenu', onContextMenu, true)
      targetWindow.removeEventListener('pointerdown', onCancel, true)
      targetWindow.removeEventListener('keydown', onCancel, true)
    }
  }, examRoot)
}
