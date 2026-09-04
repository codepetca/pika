'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/ui'

export interface CoachmarkProps {
  /** CSS selector for the element to spotlight — the actual control to use. Re-resolved on every render while open. */
  targetSelector: string
  /**
   * Optional CSS selector for the nav entry point that leads to
   * targetSelector (e.g. the rail icon for its tab). Drawn as a lighter
   * "you are here" ring alongside the primary spotlight, so the teacher
   * sees both the path and the destination at once.
   */
  pathTargetSelector?: string
  title: string
  body: string
  /** e.g. "Step 1 of 3" */
  stepLabel?: string
  open: boolean
  /** Marks the step done and closes the coachmark. */
  onAcknowledge: () => void
  /** Closes without marking the step done. */
  onSkip: () => void
}

const CARD_WIDTH = 260
const CARD_GAP = 10
const RING_PADDING = 6
const FIND_TARGET_RETRIES = 20

/**
 * A non-blocking spotlight overlay: dims the page, rings one DOM element
 * (by CSS selector), and shows a small card with copy + acknowledge/skip
 * next to it. Unlike ModalLayer, it never traps focus or makes the rest of
 * the page inert — the teacher can keep working while it's open.
 */
export function Coachmark({
  targetSelector,
  pathTargetSelector,
  title,
  body,
  stepLabel,
  open,
  onAcknowledge,
  onSkip,
}: CoachmarkProps) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [pathRect, setPathRect] = useState<DOMRect | null>(null)
  const [portalReady, setPortalReady] = useState(false)
  const ackButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => setPortalReady(true), [])

  useEffect(() => {
    if (!open) {
      setRect(null)
      setPathRect(null)
      return
    }

    let cancelled = false
    let attempt = 0
    let frame: number

    const measure = () => {
      const el = document.querySelector(targetSelector)
      if (el) setRect(el.getBoundingClientRect())
      if (pathTargetSelector) {
        const pathEl = document.querySelector(pathTargetSelector)
        setPathRect(pathEl ? pathEl.getBoundingClientRect() : null)
      }
      return Boolean(el)
    }

    const tryMeasure = () => {
      if (cancelled) return
      if (measure() || attempt >= FIND_TARGET_RETRIES) return
      attempt += 1
      frame = requestAnimationFrame(tryMeasure)
    }
    tryMeasure()

    const onViewportChange = () => {
      if (!cancelled) measure()
    }
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open, targetSelector, pathTargetSelector])

  const hasRect = rect !== null
  useEffect(() => {
    if (hasRect) ackButtonRef.current?.focus({ preventScroll: true })
  }, [hasRect])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onSkip])

  if (!open || !rect || !portalReady) return null

  const holeTop = rect.top - RING_PADDING
  const holeLeft = rect.left - RING_PADDING
  const holeWidth = rect.width + RING_PADDING * 2
  const holeHeight = rect.height + RING_PADDING * 2

  const spaceBelow = window.innerHeight - (holeTop + holeHeight)
  const cardTop = spaceBelow > 160 ? holeTop + holeHeight + CARD_GAP : Math.max(12, holeTop - 160)
  const cardLeft = Math.min(
    Math.max(12, holeLeft + holeWidth / 2 - CARD_WIDTH / 2),
    window.innerWidth - CARD_WIDTH - 12,
  )

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="fixed rounded-lg transition-[top,left,width,height] duration-standard ease-standard motion-reduce:transition-none z-popover pointer-events-none"
        style={{
          top: holeTop,
          left: holeLeft,
          width: holeWidth,
          height: holeHeight,
          boxShadow: '0 0 0 3px var(--color-warning), 0 0 0 9999px rgba(15, 23, 42, 0.45)',
        }}
      />
      {pathRect ? (
        <div
          aria-hidden="true"
          className="fixed rounded-lg transition-[top,left,width,height] duration-standard ease-standard motion-reduce:transition-none z-popover pointer-events-none"
          style={{
            top: pathRect.top - RING_PADDING,
            left: pathRect.left - RING_PADDING,
            width: pathRect.width + RING_PADDING * 2,
            height: pathRect.height + RING_PADDING * 2,
            boxShadow: '0 0 0 2px var(--color-warning)',
          }}
        />
      ) : null}
      <div
        role="dialog"
        aria-label={title}
        className="fixed z-popover rounded-control border border-border-strong bg-surface p-3.5 shadow-elevated transition-[top,left] duration-standard ease-standard motion-reduce:transition-none"
        style={{ top: cardTop, left: cardLeft, width: CARD_WIDTH }}
      >
        {stepLabel ? (
          <p className="mb-1 text-[0.6875rem] font-bold uppercase tracking-wide text-warning">{stepLabel}</p>
        ) : null}
        <h4 className="mb-1 text-sm font-bold text-text-default">{title}</h4>
        <p className="mb-3 text-sm leading-relaxed text-text-muted">{body}</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs font-medium text-text-muted hover:text-text-default"
          >
            Skip
          </button>
          <Button ref={ackButtonRef} variant="primary" size="sm" className="ml-auto" onClick={onAcknowledge}>
            Got it
          </Button>
        </div>
      </div>
    </>,
    document.body,
  )
}
