'use client'

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefCallback,
} from 'react'
import type {
  AssignmentHistoryChange,
  HistoryChangeKind,
} from '@/lib/assignment-doc-history'

export type HistoryPreviewMode = 'current' | 'fit' | 'focused' | 'locked'

interface ScrollPosition {
  left: number
  top: number
}

export interface HistoryPreviewMinimapMarker {
  top: number
  height: number
  kind: HistoryChangeKind | 'deleted'
}

export interface HistoryPreviewMinimapState {
  viewportTop: number
  viewportHeight: number
  markers: HistoryPreviewMinimapMarker[]
}

export interface HistoryPreviewViewportController {
  viewportRef: RefCallback<HTMLDivElement>
  minimapState: HistoryPreviewMinimapState | null
}

function setScrollPosition(element: HTMLElement, position: ScrollPosition) {
  element.scrollLeft = position.left
  element.scrollTop = position.top
}

function getDocumentContent(viewport: HTMLElement) {
  return viewport.querySelector<HTMLElement>('.tiptap.ProseMirror')
}

function getDocumentBlocks(content: HTMLElement | null) {
  if (!content) return []
  return Array.from(content.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  )
}

function clearChangeAnnotations(blocks: HTMLElement[]) {
  blocks.forEach((block) => {
    block.removeAttribute('data-history-change-kind')
    block.removeAttribute('data-history-deletion-before')
    block.removeAttribute('data-history-deletion-after')
  })
}

function annotateChangedBlocks(
  blocks: HTMLElement[],
  change: AssignmentHistoryChange | null | undefined,
) {
  clearChangeAnnotations(blocks)
  if (!change) return null

  change.changedBlocks.forEach(({ index, kind }) => {
    blocks[index]?.setAttribute('data-history-change-kind', kind)
  })
  change.deletionAnchors.forEach(({ index, position, count }) => {
    const block = blocks[index]
    if (!block) return
    const attribute = position === 'before'
      ? 'data-history-deletion-before'
      : 'data-history-deletion-after'
    const existingCount = Number(block.getAttribute(attribute) || 0)
    block.setAttribute(attribute, String(existingCount + count))
  })

  const changedTarget = change.changedBlocks[0]
  if (changedTarget) return blocks[changedTarget.index] ?? null
  const deletionTarget = change.deletionAnchors[0]
  return deletionTarget ? blocks[deletionTarget.index] ?? null : null
}

function clampRatio(value: number) {
  return Math.max(0, Math.min(1, value))
}

/**
 * Preserves the reader's position in the current document while history is
 * open. Focused and pinned saves stay at normal reading size and scroll to the
 * first changed block. The retained `fit` mode supports older call sites.
 */
export function useHistoryPreviewViewport(
  mode: HistoryPreviewMode,
  contentKey: unknown,
  change?: AssignmentHistoryChange | null,
): HistoryPreviewViewportController {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const previousModeRef = useRef<HistoryPreviewMode>('current')
  const previousContentKeyRef = useRef(contentKey)
  const savedScrollRef = useRef<ScrollPosition | null>(null)
  const restoreFrameRef = useRef<number | null>(null)
  const focusFrameRef = useRef<number | null>(null)
  const [minimapState, setMinimapState] = useState<HistoryPreviewMinimapState | null>(null)
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

    if (mode === 'fit') {
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
    } else if (mode === 'locked' && previousMode === 'locked' && !contentChanged) {
      // Preserve manual reading position while the same pinned save remains active.
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
    const content = getDocumentContent(viewport)

    const measure = () => {
      measureFrame = null
      const currentViewport = viewportRef.current
      const currentContent = currentViewport ? getDocumentContent(currentViewport) : null
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

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const previewActive = mode === 'focused' || mode === 'locked'
    let resizeObserver: ResizeObserver | null = null
    let mutationObserver: MutationObserver | null = null
    let metricsFrame: number | null = null

    const updateMetrics = () => {
      metricsFrame = null
      const currentViewport = viewportRef.current
      const content = currentViewport ? getDocumentContent(currentViewport) : null
      if (!currentViewport || !content || !previewActive || !change) {
        setMinimapState(null)
        return
      }

      const blocks = getDocumentBlocks(content)
      const documentHeight = Math.max(content.scrollHeight, currentViewport.scrollHeight, 1)
      const markers: HistoryPreviewMinimapMarker[] = []

      change.changedBlocks.forEach(({ index, kind }) => {
        const block = blocks[index]
        if (!block) return
        markers.push({
          top: clampRatio(block.offsetTop / documentHeight),
          height: Math.max(0.018, clampRatio(block.offsetHeight / documentHeight)),
          kind,
        })
      })
      change.deletionAnchors.forEach(({ index }) => {
        const block = blocks[index]
        if (!block) return
        markers.push({
          top: clampRatio(block.offsetTop / documentHeight),
          height: 0.012,
          kind: 'deleted',
        })
      })

      setMinimapState({
        viewportTop: clampRatio(currentViewport.scrollTop / documentHeight),
        viewportHeight: Math.max(0.08, clampRatio(currentViewport.clientHeight / documentHeight)),
        markers,
      })
    }

    const scheduleMetrics = () => {
      if (metricsFrame !== null) window.cancelAnimationFrame(metricsFrame)
      metricsFrame = window.requestAnimationFrame(updateMetrics)
    }

    const applyFocus = () => {
      focusFrameRef.current = null
      const currentViewport = viewportRef.current
      const content = currentViewport ? getDocumentContent(currentViewport) : null
      if (!currentViewport || !content) return

      const blocks = getDocumentBlocks(content)
      const target = annotateChangedBlocks(blocks, previewActive ? change : null)
      if (previewActive && target) {
        const desiredTop = target.offsetTop
          - Math.max(24, (currentViewport.clientHeight - target.offsetHeight) * 0.35)
        currentViewport.scrollTop = Math.max(0, desiredTop)
        currentViewport.scrollLeft = 0
      }
      scheduleMetrics()
    }

    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current)
    focusFrameRef.current = window.requestAnimationFrame(applyFocus)

    viewport.addEventListener('scroll', scheduleMetrics, { passive: true })
    const content = getDocumentContent(viewport)
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleMetrics)
      resizeObserver.observe(viewport)
      if (content) resizeObserver.observe(content)
    }
    if (typeof MutationObserver !== 'undefined' && content) {
      mutationObserver = new MutationObserver(() => {
        if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current)
        focusFrameRef.current = window.requestAnimationFrame(applyFocus)
      })
      mutationObserver.observe(content, { childList: true, subtree: true })
    }

    return () => {
      viewport.removeEventListener('scroll', scheduleMetrics)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      if (metricsFrame !== null) window.cancelAnimationFrame(metricsFrame)
      if (focusFrameRef.current !== null) {
        window.cancelAnimationFrame(focusFrameRef.current)
        focusFrameRef.current = null
      }
      clearChangeAnnotations(getDocumentBlocks(getDocumentContent(viewport)))
    }
  }, [change, contentKey, mode])

  useLayoutEffect(() => () => {
    if (restoreFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFrameRef.current)
    }
    if (focusFrameRef.current !== null) {
      window.cancelAnimationFrame(focusFrameRef.current)
    }
  }, [])

  return { viewportRef: setViewportRef, minimapState }
}
