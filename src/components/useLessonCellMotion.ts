'use client'

import { useCallback, useLayoutEffect, useRef } from 'react'

/** Calendar disclosure owns geometry only; editing and saving remain immediate. */
export function useLessonCellMotion(open: boolean, owner: string, compact = false) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const pendingRef = useRef<{ height: number; owner: string } | null>(null)
  const activeRef = useRef(false)
  const frameRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openingRef = useRef(open)
  const durationRef = useRef(0)
  const previousRef = useRef<{ owner: string; compact: boolean } | null>(null)
  const visibleHeightRef = useRef<{ owner: string; height: number } | null>(null)

  const cancelWork = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    frameRef.current = null
    timerRef.current = null
  }, [])

  const settle = useCallback(() => {
    cancelWork()
    activeRef.current = false
    const outer = outerRef.current
    if (outer) {
      outer.style.removeProperty('height')
      outer.style.removeProperty('overflow')
    }
  }, [cancelWork])

  const prepare = useCallback(() => {
    const outer = outerRef.current
    if (!outer) return
    pendingRef.current = { height: outer.getBoundingClientRect().height, owner }
    cancelWork()
  }, [cancelWork, owner])

  const retarget = useCallback(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner || !activeRef.current) return
    const height = inner.getBoundingClientRect().height
    // The editor's initial null render is not its opening destination.
    if (openingRef.current && height === 0) return
    const target = `${height}px`
    if (outer.style.height === target && timerRef.current !== null) return
    outer.style.height = target
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(settle, durationRef.current + 50)
  }, [settle])

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    const previous = previousRef.current
    previousRef.current = { owner, compact }
    const cached = visibleHeightRef.current
    // A sibling in the same grid week can change this preview's density. Cache
    // committed geometry before that render, rather than reading the new size
    // and allowing the tallest auto-sized track to jump to its destination.
    const compactChanged = previous?.owner === owner && previous.compact !== compact
    const pending = pendingRef.current ?? (compactChanged && cached?.owner === owner ? cached : null)
    pendingRef.current = null
    if (!outer || !inner || !pending || pending.owner !== owner
      || typeof ResizeObserver === 'undefined'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settle()
      return
    }
    activeRef.current = true
    openingRef.current = open
    const duration = getComputedStyle(outer).getPropertyValue('--motion-duration-standard').trim()
    const milliseconds = duration.endsWith('ms') ? parseFloat(duration) : parseFloat(duration) * 1000
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
      settle()
      return
    }
    durationRef.current = milliseconds
    outer.style.height = `${pending.height}px`
    outer.style.overflow = 'hidden'
    // Establish the visible start before targeting the newly committed content.
    outer.getBoundingClientRect()
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      if (!activeRef.current) return
      retarget()
    })
  }, [open, owner, compact, retarget, settle])

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleMotionChange = () => { if (media.matches) settle() }
    const handleEnd = (event: TransitionEvent) => {
      if (event.target === outer && event.propertyName === 'height') settle()
    }
    // TipTap first renders null. Observe its actual mounted height while opening,
    // but leave typing, refreshes and resizing at natural height after settling.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      visibleHeightRef.current = { owner, height: outer.getBoundingClientRect().height }
      if (activeRef.current && frameRef.current === null) {
        retarget()
      }
    })
    visibleHeightRef.current = { owner, height: outer.getBoundingClientRect().height }
    observer?.observe(inner)
    observer?.observe(outer)
    outer.addEventListener('transitionend', handleEnd)
    media.addEventListener('change', handleMotionChange)
    return () => {
      observer?.disconnect()
      outer.removeEventListener('transitionend', handleEnd)
      media.removeEventListener('change', handleMotionChange)
      pendingRef.current = null
      visibleHeightRef.current = null
      settle()
    }
  }, [owner, retarget, settle])

  return { outerRef, innerRef, prepare, settle }
}
