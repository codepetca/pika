/** Attach to the exam document and accessible frames, including later frame loads. */
export function observeExamDocuments(
  examWindow: Window,
  attachListeners: (window: Window, document: Document) => () => void,
  root?: HTMLElement
): () => void {
  const rootDocument = examWindow.document
  const attached = new Map<Document, { onLoad: EventListener; cleanup: () => void }>()
  const frameDocuments = new Map<HTMLIFrameElement, Document>()

  function detach(targetDocument: Document) {
    for (const [frame, childDocument] of frameDocuments) {
      if (frame.ownerDocument === targetDocument) {
        frameDocuments.delete(frame)
        detach(childDocument)
      }
    }
    const listeners = attached.get(targetDocument)
    if (!listeners) return
    targetDocument.removeEventListener('load', listeners.onLoad, true)
    try {
      listeners.cleanup()
    } catch {
      // A reference may have navigated to an inaccessible origin since attachment.
    }
    attached.delete(targetDocument)
  }

  function attachFrame(frame: HTMLIFrameElement) {
    const previous = frameDocuments.get(frame)
    let targetWindow: Window | null = null
    let targetDocument: Document | null = null
    try {
      if (!root || frame.ownerDocument !== rootDocument || root.contains(frame)) {
        targetWindow = frame.contentWindow
        targetDocument = frame.contentDocument
      }
    } catch {
      // Browser-owned viewers and cross-origin frames do not expose their events.
    }
    if (previous && previous !== targetDocument) {
      frameDocuments.delete(frame)
      detach(previous)
    }
    if (!targetWindow || !targetDocument) return
    frameDocuments.set(frame, targetDocument)
    attach(targetWindow, targetDocument)
  }

  function attach(targetWindow: Window, targetDocument: Document) {
    if (attached.has(targetDocument)) return
    const onLoad: EventListener = event => {
      const target = event.target as Element | null
      if (target?.tagName === 'IFRAME') attachFrame(target as HTMLIFrameElement)
    }
    attached.set(targetDocument, { onLoad, cleanup: attachListeners(targetWindow, targetDocument) })
    targetDocument.addEventListener('load', onLoad, true)
    const frameRoot = targetDocument === rootDocument && root ? root : targetDocument
    frameRoot.querySelectorAll('iframe').forEach(attachFrame)
  }

  attach(examWindow, rootDocument)
  return () => {
    for (const targetDocument of attached.keys()) detach(targetDocument)
    frameDocuments.clear()
  }
}
