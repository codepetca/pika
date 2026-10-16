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
  const attached = new Map<Document, { window: Window; onLoad: EventListener }>()

  function attachFrame(frame: HTMLIFrameElement) {
    try {
      if (frame.contentWindow && frame.contentDocument) {
        attach(frame.contentWindow, frame.contentDocument)
      }
    } catch {
      // Browser-owned viewers and cross-origin frames do not expose their keyboard events.
    }
  }

  function attach(targetWindow: Window, targetDocument: Document) {
    if (attached.has(targetDocument)) return
    const onLoad: EventListener = event => {
      const target = event.target as Element | null
      if (target?.tagName === 'IFRAME') attachFrame(target as HTMLIFrameElement)
    }
    attached.set(targetDocument, { window: targetWindow, onLoad })
    targetWindow.addEventListener('keydown', preventBrowserFind, true)
    targetDocument.addEventListener('load', onLoad, true)
    targetDocument.querySelectorAll('iframe').forEach(attachFrame)
  }

  attach(examWindow, examWindow.document)
  return () => {
    for (const [document, { window, onLoad }] of attached) {
      try {
        window.removeEventListener('keydown', preventBrowserFind, true)
      } catch {
        // A reference may have navigated to an inaccessible origin since attachment.
      }
      document.removeEventListener('load', onLoad, true)
    }
    attached.clear()
  }
}
