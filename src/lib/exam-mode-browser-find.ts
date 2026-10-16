import { observeExamDocuments } from '@/lib/exam-mode-documents'

function preventBrowserFind(event: KeyboardEvent) {
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'f'
  ) {
    event.preventDefault()
  }
}

/** Block Find in the exam and accessible references, including frames loaded later. */
export function blockExamBrowserFind(examWindow: Window): () => void {
  return observeExamDocuments(examWindow, targetWindow => {
    targetWindow.addEventListener('keydown', preventBrowserFind, true)
    return () => {
      targetWindow.removeEventListener('keydown', preventBrowserFind, true)
    }
  })
}
