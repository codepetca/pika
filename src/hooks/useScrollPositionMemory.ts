'use client'

import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

interface UseScrollPositionMemoryOptions {
  key: string | null
  enabled?: boolean
  restoreToken?: string | number | boolean | null
}

interface UseScrollPositionMemoryResult<T extends HTMLElement> {
  scrollRef: RefObject<T>
  preserveScrollPosition: () => void
  restoreScrollPosition: () => void
}

export function useScrollPositionMemory<T extends HTMLElement>({
  key,
  enabled = true,
  restoreToken = null,
}: UseScrollPositionMemoryOptions): UseScrollPositionMemoryResult<T> {
  const scrollRef = useRef<T | null>(null)
  const scrollTopByKeyRef = useRef<Record<string, number>>({})

  const preserveScrollPosition = useCallback(() => {
    if (!enabled || !key) return
    const node = scrollRef.current
    if (!node) return
    scrollTopByKeyRef.current[key] = node.scrollTop
  }, [enabled, key])

  const restoreScrollPosition = useCallback(() => {
    if (!enabled || !key) return
    const node = scrollRef.current
    if (!node) return
    const storedScrollTop = scrollTopByKeyRef.current[key] ?? 0
    if (node.scrollTop !== storedScrollTop) {
      node.scrollTop = storedScrollTop
    }
  }, [enabled, key])

  useLayoutEffect(() => {
    restoreScrollPosition()
    const frameId =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(restoreScrollPosition)
        : null

    return () => {
      if (frameId !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [enabled, key, restoreScrollPosition, restoreToken])

  return {
    scrollRef,
    preserveScrollPosition,
    restoreScrollPosition,
  }
}
