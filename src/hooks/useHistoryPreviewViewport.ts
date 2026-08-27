'use client'

import { useCallback, useLayoutEffect, useRef, type RefCallback } from 'react'

export type HistoryPreviewMode = 'current' | 'fit' | 'locked'

interface ScrollPosition {
  left: number
  top: number
}

function setScrollPosition(element: HTMLElement, position: ScrollPosition) {
  element.scrollLeft = position.left
  element.scrollTop = position.top
}

/**
 * Fits transient history previews into their existing document viewport while
 * preserving the reader's position in the current document. A pinned preview
 * returns to normal scale so it can be read and scrolled as usual.
 */
export function useHistoryPreviewViewport(
  mode: HistoryPreviewMode,
  contentKey: unknown,
): RefCallback<HTMLDivElement> {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const previousModeRef = useRef<HistoryPreviewMode>('current')
  const previousContentKeyRef = useRef(contentKey)
  const savedScrollRef = useRef<ScrollPosition | null>(null)
  const restoreFrameRef = useRef<number | null>(null)
  const setViewportRef = useCallback((element: HTMLDivElement | null) => {
    viewportRef.current = element
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    if (restoreFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFrameRef.current)
      restoreFrameRef.current = null
    }

    const previousMode = previousModeRef.current
    const contentChanged = previousContentKeyRef.current !== contentKey

    if (previousMode === 'current' && mode !== 'current') {
      savedScrollRef.current = {
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      }
    }

    if (
      mode === 'fit'
      || (mode === 'locked' && (previousMode !== 'locked' || contentChanged))
    ) {
      setScrollPosition(viewport, { left: 0, top: 0 })
    } else if (mode === 'current' && previousMode !== 'current') {
      const savedScroll = savedScrollRef.current
      restoreFrameRef.current = window.requestAnimationFrame(() => {
        restoreFrameRef.current = null
        if (savedScroll && viewportRef.current) {
          setScrollPosition(viewportRef.current, savedScroll)
        }
        savedScrollRef.current = null
      })
    }

    previousModeRef.current = mode
    previousContentKeyRef.current = contentKey
  }, [contentKey, mode])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    if (mode !== 'fit') {
      viewport.style.setProperty('--history-preview-scale', '1')
      return
    }

    let measureFrame: number | null = null
    const content = viewport.querySelector<HTMLElement>('.tiptap.ProseMirror')

    const measure = () => {
      measureFrame = null
      const currentViewport = viewportRef.current
      const currentContent = currentViewport?.querySelector<HTMLElement>('.tiptap.ProseMirror')
      if (!currentViewport || !currentContent) return

      const bounds = currentViewport.getBoundingClientRect()
      const availableWidth = currentViewport.clientWidth || bounds.width
      const availableHeight = currentViewport.clientHeight || bounds.height
      const naturalWidth = Math.max(currentContent.scrollWidth, currentContent.offsetWidth)
      const naturalHeight = Math.max(currentContent.scrollHeight, currentContent.offsetHeight)

      if (
        availableWidth <= 0
        || availableHeight <= 0
        || naturalWidth <= 0
        || naturalHeight <= 0
      ) {
        currentViewport.style.setProperty('--history-preview-scale', '1')
        return
      }

      const scale = Math.min(
        1,
        availableWidth / naturalWidth,
        availableHeight / naturalHeight,
      )
      currentViewport.style.setProperty('--history-preview-scale', String(Math.max(0.01, scale)))
    }

    const scheduleMeasure = () => {
      if (measureFrame !== null) window.cancelAnimationFrame(measureFrame)
      measureFrame = window.requestAnimationFrame(measure)
    }

    scheduleMeasure()

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleMeasure)
    resizeObserver?.observe(viewport)
    if (content) resizeObserver?.observe(content)

    const images = content ? Array.from(content.querySelectorAll('img')) : []
    images.forEach((image) => image.addEventListener('load', scheduleMeasure))

    return () => {
      if (measureFrame !== null) window.cancelAnimationFrame(measureFrame)
      resizeObserver?.disconnect()
      images.forEach((image) => image.removeEventListener('load', scheduleMeasure))
    }
  }, [contentKey, mode])

  useLayoutEffect(() => () => {
    if (restoreFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFrameRef.current)
    }
  }, [])

  return setViewportRef
}
