'use client'

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cva } from 'class-variance-authority'
import { cn } from './utils'

// Tooltip content styles with CVA
const tooltipContentStyles = cva([
  'z-popover max-w-[min(20rem,calc(100vw-1rem))] rounded-lg border px-3 py-2 text-xs leading-relaxed pointer-events-none',
  'bg-surface',
  'text-text-default',
  'shadow-lg border-border-strong',
])

export interface TooltipProps {
  /** The content to display in the tooltip */
  content: ReactNode
  /** The element that triggers the tooltip */
  children: ReactNode
  /** Whether the tooltip content itself can be hovered/clicked */
  interactive?: boolean
  /** Delay in ms before showing tooltip (default: 100) */
  delayDuration?: number
  /** Side of the trigger to render tooltip (default: 'bottom') */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Alignment of tooltip relative to trigger (default: 'center') */
  align?: 'start' | 'center' | 'end'
  /** Optional Tailwind classes for the tooltip content wrapper */
  className?: string
  /** Prevent the tooltip from opening while preserving its trigger structure. */
  disabled?: boolean
  /** Allow help-only triggers to toggle their content with a click or tap. */
  openOnClick?: boolean
}

/**
 * Fast tooltip component using Radix UI.
 * Replaces native title attributes with customizable delay and consistent styling.
 *
 * @example
 * <Tooltip content="Open panel">
 *   <button><PanelRight /></button>
 * </Tooltip>
 */
export function Tooltip({
  content,
  children,
  interactive = false,
  delayDuration = 100,
  side = 'bottom',
  align = 'center',
  className,
  disabled = false,
  openOnClick = false,
}: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [closing, setClosing] = useState<{ node: HTMLDivElement; duration: number } | null>(null)
  const rejectDelayedOpen = useRef(false)
  const pointerOpenRef = useRef<boolean | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [pageHidden, setPageHidden] = useState(false)
  const available = !disabled && !pageHidden
  const open = available && isOpen

  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => setReducedMotion(media.matches)
    const updateVisibility = () => {
      const hidden = document.visibilityState === 'hidden'
      setPageHidden(hidden)
      if (hidden) {
        rejectDelayedOpen.current = true
        setClosing(null)
        setIsOpen(false)
        pointerOpenRef.current = null
      }
    }
    updateMotion()
    updateVisibility()
    media.addEventListener('change', updateMotion)
    document.addEventListener('visibilitychange', updateVisibility)
    return () => {
      media.removeEventListener('change', updateMotion)
      document.removeEventListener('visibilitychange', updateVisibility)
    }
  }, [])

  useLayoutEffect(() => {
    if (!available) {
      rejectDelayedOpen.current = true
      setClosing(null)
      setIsOpen(false)
      pointerOpenRef.current = null
    }
  }, [available])

  useLayoutEffect(() => {
    if (reducedMotion) setClosing(null)
  }, [reducedMotion])

  useLayoutEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(() => setClosing((current) => current === closing ? null : current), closing.duration)
    return () => window.clearTimeout(timer)
  }, [closing])

  const changeOpen = (nextOpen: boolean) => {
    if (!available || (nextOpen && rejectDelayedOpen.current)) return
    if (nextOpen) {
      setClosing(null)
    } else if (open && !reducedMotion && contentRef.current) {
      const source = contentRef.current
      const style = getComputedStyle(source)
      const durationToken = style.getPropertyValue('--motion-duration-fast').trim()
      const durationMatch = durationToken.match(/^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/)
      const duration = durationMatch ? Number(durationMatch[1]) * (durationMatch[2] === 's' ? 1000 : 1) : 0
      // Only static DOM can outlive Radix's interactive owner. Reject a whole
      // subtree containing widgets, media, custom elements or executable nodes.
      const safeTags = new Set(['div', 'span', 'p', 'h1', 'h2', 'h3', 'blockquote', 'a', 'strong', 'b', 'em', 'i', 'small', 'br', 'code', 'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'title'])
      if (duration > 0 && Number.isFinite(duration) && [...source.querySelectorAll('*')].every((node) => safeTags.has(node.localName))) {
        const node = source.cloneNode(true) as HTMLDivElement
        for (const element of [node, ...node.querySelectorAll('*')]) {
          for (const attribute of [...element.attributes]) {
            if (/^(?:on|aria-)/i.test(attribute.name) || /^(?:id|role|href|xlink:href|target|tabindex|contenteditable|autofocus|download|name|for)$/i.test(attribute.name)) element.removeAttribute(attribute.name)
          }
          if (element instanceof HTMLElement || element instanceof SVGElement) element.style.pointerEvents = 'none'
        }
        const rect = source.getBoundingClientRect()
        node.inert = true
        node.setAttribute('inert', '')
        node.setAttribute('aria-hidden', 'true')
        node.setAttribute('data-tooltip-exit', '')
        node.removeAttribute('data-tooltip-presentation')
        node.style.setProperty('--tooltip-exit-opacity', style.opacity || '1')
        node.removeAttribute('data-state')
        Object.assign(node.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, boxSizing: 'border-box', margin: '0', transform: 'none' })
        setClosing({ node, duration })
      }
    }
    setIsOpen(nextOpen)
  }

  return (
    <TooltipPrimitive.Root
      delayDuration={delayDuration}
      disableHoverableContent={!interactive}
      open={open}
      onOpenChange={changeOpen}
    >
      <TooltipPrimitive.Trigger
        asChild
        onPointerDown={openOnClick ? () => { pointerOpenRef.current = open } : undefined}
        onPointerEnter={() => { if (available) rejectDelayedOpen.current = false }}
        onPointerLeave={() => { rejectDelayedOpen.current = false }}
        onFocus={() => { if (available) rejectDelayedOpen.current = false }}
        onPointerCancel={openOnClick ? () => { pointerOpenRef.current = null } : undefined}
        onClick={openOnClick ? (event) => {
          event.preventDefault()
          const wasOpen = pointerOpenRef.current ?? open
          pointerOpenRef.current = null
          if (available) rejectDelayedOpen.current = false
          changeOpen(!wasOpen)
        } : undefined}
      >{children}</TooltipPrimitive.Trigger>
      {available && (open || !reducedMotion) && <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          ref={contentRef}
          data-tooltip-presentation=""
          side={side}
          align={align}
          sideOffset={4}
          className={cn('tooltip-opacity', tooltipContentStyles(), interactive && 'pointer-events-auto', className)}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>}
      {closing && available && !reducedMotion && <TooltipPrimitive.Portal forceMount>
        <div aria-hidden="true" style={{ display: 'contents', pointerEvents: 'none' }} ref={(host) => {
          if (host && closing.node.parentNode !== host) host.replaceChildren(closing.node)
        }} />
      </TooltipPrimitive.Portal>}
    </TooltipPrimitive.Root>
  )
}

/**
 * Provider that enables tooltips throughout the app.
 * Wrap your app or layout with this component.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={100} skipDelayDuration={300} disableHoverableContent>
      {children}
    </TooltipPrimitive.Provider>
  )
}
