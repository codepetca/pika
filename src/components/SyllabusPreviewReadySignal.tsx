'use client'

import { useEffect } from 'react'
import {
  SYLLABUS_PREVIEW_READY,
  isSyllabusPreviewReadyRequest,
} from '@/lib/syllabus-preview-messages'

export function SyllabusPreviewReadySignal() {
  useEffect(() => {
    if (window.parent === window) return

    const notifyParent = () => {
      window.parent.postMessage(
        { type: SYLLABUS_PREVIEW_READY, href: window.location.href },
        window.location.origin,
      )
    }
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent ||
        !isSyllabusPreviewReadyRequest(event.data)
      ) {
        return
      }
      notifyParent()
    }

    window.addEventListener('message', handleMessage)
    notifyParent()
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  return null
}
