'use client'

import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import { safeSessionGetJson, safeSessionSetJson } from '@/lib/client-storage'

interface UseScrollPositionMemoryOptions {
  key: string | null
  enabled?: boolean
  restoreToken?: string | number | boolean | null
  storageKey?: string | null
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
  storageKey = null,
}: UseScrollPositionMemoryOptions): UseScrollPositionMemoryResult<T> {
  const scrollRef = useRef<T | null>(null)
  const scrollTopByKeyRef = useRef<Record<string, number>>({})

  const readStoredScrollTop = useCallback(() => {
    if (!storageKey) return null
    const storedValue = safeSessionGetJson<unknown>(storageKey)
    if (typeof storedValue !== 'number' || !Number.isFinite(storedValue)) return null
    return Math.max(0, storedValue)
  }, [storageKey])

  const preserveScrollPosition = useCallback(() => {
    if (!enabled || !key) return
    const node = scrollRef.current
    if (!node) return
    const nextScrollTop = node.scrollTop
    scrollTopByKeyRef.current[key] = nextScrollTop
    if (storageKey) {
      safeSessionSetJson(storageKey, nextScrollTop)
    }
  }, [enabled, key, storageKey])

  const restoreScrollPosition = useCallback(() => {
    if (!enabled || !key) return
    const node = scrollRef.current
    if (!node) return
    const storedScrollTop = scrollTopByKeyRef.current[key] ?? readStoredScrollTop() ?? 0
    if (node.scrollTop !== storedScrollTop) {
      node.scrollTop = storedScrollTop
    }
  }, [enabled, key, readStoredScrollTop])

  useLayoutEffect(() => {
    restoreScrollPosition()
    let secondFrameId: number | null = null
    const frameId =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(() => {
            restoreScrollPosition()
            secondFrameId = window.requestAnimationFrame(restoreScrollPosition)
          })
        : null
    const timeoutId =
      typeof window.setTimeout === 'function'
        ? window.setTimeout(restoreScrollPosition, 50)
        : null

    return () => {
      if (frameId !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frameId)
      }
      if (secondFrameId !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(secondFrameId)
      }
      if (timeoutId !== null && typeof window.clearTimeout === 'function') {
        window.clearTimeout(timeoutId)
      }
    }
  }, [enabled, key, restoreScrollPosition, restoreToken])

  return {
    scrollRef,
    preserveScrollPosition,
    restoreScrollPosition,
  }
}
