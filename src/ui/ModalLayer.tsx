'use client'

import {
  useEffect,
  useRef,
  type AriaRole,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface ElementState {
  inert: boolean
  ariaHidden: string | null
}

const openLayers: HTMLElement[] = []
const elementStates = new Map<HTMLElement, ElementState>()
let originalBodyOverflow: string | undefined

function restoreElement(element: HTMLElement) {
  const state = elementStates.get(element)
  if (!state) return

  element.inert = state.inert
  if (state.ariaHidden === null) {
    element.removeAttribute('aria-hidden')
  } else {
    element.setAttribute('aria-hidden', state.ariaHidden)
  }
}

function updateModalEnvironment() {
  const body = document.body
  const topLayer = openLayers.at(-1)

  if (!topLayer) {
    for (const element of elementStates.keys()) restoreElement(element)
    elementStates.clear()
    if (originalBodyOverflow !== undefined) {
      body.style.overflow = originalBodyOverflow
      originalBodyOverflow = undefined
    }
    return
  }

  if (originalBodyOverflow === undefined) {
    originalBodyOverflow = body.style.overflow
  }
  body.style.overflow = 'hidden'

  for (const child of Array.from(body.children)) {
    if (!(child instanceof HTMLElement)) continue
    if (!elementStates.has(child)) {
      elementStates.set(child, {
        inert: child.inert === true,
        ariaHidden: child.getAttribute('aria-hidden'),
      })
    }

    if (child === topLayer) {
      restoreElement(child)
    } else {
      child.inert = true
      child.setAttribute('aria-hidden', 'true')
    }
  }
}

function registerLayer(layer: HTMLElement) {
  openLayers.push(layer)
  updateModalEnvironment()
  return () => {
    const index = openLayers.lastIndexOf(layer)
    if (index >= 0) openLayers.splice(index, 1)
    updateModalEnvironment()
  }
}

function isTopLayer(layer: HTMLElement) {
  return openLayers.at(-1) === layer
}

function getFocusableElements(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
  )
}

export interface ModalLayerProps {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
  role?: AriaRole
  ariaLabel?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  initialFocusRef?: RefObject<HTMLElement>
  onEnter?: () => void
  closeOnEscape?: boolean
  closeOnBackdrop?: boolean
  backdropLabel?: string
  rootClassName?: string
  backdropClassName?: string
  panelClassName?: string
}

/**
 * Shared modal behavior for dialogs and mobile drawers.
 *
 * The layer portals to document.body, isolates the active surface, contains
 * keyboard focus, locks page scroll, and restores focus to the opener.
 */
export function ModalLayer({
  isOpen,
  onClose,
  children,
  role = 'dialog',
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  initialFocusRef,
  onEnter,
  closeOnEscape = true,
  closeOnBackdrop = true,
  backdropLabel = 'Close dialog',
  rootClassName = 'flex items-center justify-center p-4',
  backdropClassName = 'bg-black/50 dark:bg-black/70',
  panelClassName,
}: ModalLayerProps) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  const onEnterRef = useRef(onEnter)
  const closeOnEscapeRef = useRef(closeOnEscape)
  const initialFocusRefRef = useRef(initialFocusRef)
  onCloseRef.current = onClose
  onEnterRef.current = onEnter
  closeOnEscapeRef.current = closeOnEscape
  initialFocusRefRef.current = initialFocusRef

  useEffect(() => {
    if (!isOpen) return
    const layer = layerRef.current
    if (!layer) return
    const panel = panelRef.current
    if (!panel) return
    const activeLayer: HTMLElement = layer
    const activePanel: HTMLElement = panel

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const unregister = registerLayer(activeLayer)

    if (!activePanel.contains(document.activeElement)) {
      const requestedTarget = initialFocusRefRef.current?.current
      const target = requestedTarget?.matches(':disabled')
        ? null
        : requestedTarget ?? activePanel.querySelector<HTMLElement>('[data-modal-initial-focus]')
      ;(target ?? activePanel).focus()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!isTopLayer(activeLayer)) return

      if (event.key === 'Escape' && closeOnEscapeRef.current) {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }

      if (event.key === 'Enter' && onEnterRef.current) {
        event.preventDefault()
        event.stopPropagation()
        onEnterRef.current()
        return
      }

      if (event.key !== 'Tab') return

      const focusableElements = getFocusableElements(activePanel)
      if (focusableElements.length === 0) {
        event.preventDefault()
        activePanel.focus()
        return
      }

      const first = focusableElements[0]
      const last = focusableElements[focusableElements.length - 1]
      const activeElement = document.activeElement

      if (
        event.shiftKey &&
        (activeElement === activePanel || activeElement === first || !activePanel.contains(activeElement))
      ) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        (activeElement === activePanel || activeElement === last || !activePanel.contains(activeElement))
      ) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      unregister()
      if (opener?.isConnected) opener.focus()
    }
  }, [isOpen])

  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <div ref={layerRef} className={`fixed inset-0 z-50 ${rootClassName}`}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={backdropLabel}
        disabled={!closeOnBackdrop}
        className={`absolute inset-0 ${backdropClassName}`}
        onClick={closeOnBackdrop ? () => onCloseRef.current() : undefined}
      />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        className={`focus:outline-none ${panelClassName ?? ''}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
