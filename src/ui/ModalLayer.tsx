'use client'

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type AriaRole,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
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

interface LayerEntry {
  layer: HTMLElement
  panel: HTMLElement
  isOpen: () => boolean
  returnTargets: HTMLElement[]
}

const openLayers: LayerEntry[] = []
// React runs every layout cleanup before sibling setups. Keep return provenance
// through that handoff even when an immediate exit has already removed its DOM.
const pendingFocusReturns: LayerEntry[] = []
const elementStates = new Map<HTMLElement, ElementState>()
let originalBodyOverflow: string | undefined

function restoreElement(element: HTMLElement) {
  if (element.dataset.modalState === 'closing') {
    element.inert = true
    element.setAttribute('aria-hidden', 'true')
    return
  }
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
  const topLayer = getTopLayer()?.layer

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
        // Modal roots own these values. An exiting root must not become the
        // saved inert baseline when another dialog opens during its exit.
        inert: child.dataset.modalState ? false : child.inert === true,
        ariaHidden: child.dataset.modalState ? null : child.getAttribute('aria-hidden'),
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

function getTopLayer() {
  return openLayers.findLast((entry) => entry.isOpen() && entry.layer.isConnected)
}

function registerLayer(entry: LayerEntry) {
  // A rapid reopen can reuse an older portal node. Keep its paint order aligned
  // with the active stack without creating another portal or changing z tokens.
  if (document.body.lastElementChild !== entry.layer) document.body.appendChild(entry.layer)
  openLayers.push(entry)
  updateModalEnvironment()
  return () => {
    const wasTop = openLayers.at(-1) === entry
    const index = openLayers.lastIndexOf(entry)
    if (index >= 0) openLayers.splice(index, 1)
    if (wasTop) pendingFocusReturns.push(entry)
    updateModalEnvironment()
    return () => {
      const pendingIndex = pendingFocusReturns.lastIndexOf(entry)
      if (pendingIndex >= 0) pendingFocusReturns.splice(pendingIndex, 1)
      if (!wasTop) return
      const top = getTopLayer()
      const active = document.activeElement
      // A replacement may already have focused its requested control. Its
      // earlier sibling's deferred return must not override that valid focus.
      if (top && active instanceof HTMLElement && top.panel.contains(active)
        && !active.closest('[inert], [hidden], [aria-hidden="true"], [data-modal-state="closing"]')) return
      const target = entry.returnTargets.find((candidate) =>
        candidate.isConnected
        && !candidate.closest('[inert], [hidden], [aria-hidden="true"], [data-modal-state="closing"]')
        && !candidate.matches(':disabled')
        && (!top || top.panel.contains(candidate)),
      )
      const destination = target ?? top?.panel
      if (destination) {
        destination.focus()
      } else if (document.activeElement instanceof HTMLElement && entry.layer.contains(document.activeElement)) {
        // A removed/disabled opener must not leave focus inside the inert exit.
        document.activeElement.blur()
      }
    }
  }
}

function isTopLayer(layer: HTMLElement) {
  return getTopLayer()?.layer === layer
}

function isClosedLayerEvent(event: Event) {
  return event.target instanceof Element
    && event.target.closest('[data-modal-state="closing"]') !== null
}

function exitDuration(layer: HTMLElement) {
  const token = getComputedStyle(layer).getPropertyValue('--motion-duration-standard').trim()
  const match = token.match(/^(\d*\.?\d+)(ms|s)$/)
  const duration = match ? Number(match[1]) * (match[2] === 's' ? 1000 : 1) : 0
  return Number.isFinite(duration) ? duration : 0
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
  /**
   * Opt-in visual retention. Commands and logical close remain immediate, but
   * descendants stay mounted until the opacity exit ends. Keep effect-bearing
   * editors/widgets immediate unless their owner explicitly accepts that lifetime.
   */
  exitMotion?: 'none' | 'opacity'
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
  backdropClassName = 'bg-overlay-scrim',
  panelClassName,
  exitMotion = 'none',
}: ModalLayerProps) {
  const [present, setPresent] = useState(isOpen)
  const logicalOpenRef = useRef(isOpen)
  const presentation = {
    children, role, ariaLabel, ariaLabelledBy, ariaDescribedBy,
    rootClassName, backdropClassName, panelClassName, backdropLabel,
  }
  const lastOpenPresentation = useRef(presentation)
  const exitGeneration = useRef(0)
  const restoreFocusRef = useRef<(() => void) | undefined>(undefined)
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

  // Retain committed presentation only. Logical close still reaches the parent
  // immediately; opting in deliberately extends these descendants' mount life.
  useLayoutEffect(() => {
    logicalOpenRef.current = isOpen
    if (isOpen) lastOpenPresentation.current = presentation
  })

  useLayoutEffect(() => {
    const generation = ++exitGeneration.current
    if (isOpen) {
      setPresent(true)
      return
    }

    const layer = layerRef.current
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const duration = layer && exitMotion === 'opacity' && !media.matches ? exitDuration(layer) : 0
    if (duration <= 0) {
      setPresent(false)
      return
    }

    const handleMotionChange = () => { if (media.matches) finish() }
    const finish = () => {
      window.clearTimeout(timer)
      media.removeEventListener('change', handleMotionChange)
      if (exitGeneration.current === generation && !logicalOpenRef.current) setPresent(false)
    }
    const timer = window.setTimeout(finish, duration)
    media.addEventListener('change', handleMotionChange)
    return () => {
      ++exitGeneration.current
      window.clearTimeout(timer)
      media.removeEventListener('change', handleMotionChange)
    }
  }, [isOpen, exitMotion])

  useLayoutEffect(() => {
    // React restores its captured DOM focus between layout cleanup and setup.
    // Return focus after that restoration, still before the closing paint.
    restoreFocusRef.current?.()
    restoreFocusRef.current = undefined
    if (!isOpen) return
    const layer = layerRef.current
    if (!layer) return
    const panel = panelRef.current
    if (!panel) return
    const activeLayer: HTMLElement = layer
    const activePanel: HTMLElement = panel

    activeLayer.dataset.modalState = 'open'
    activeLayer.inert = false
    activeLayer.removeAttribute('aria-hidden')
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusedDescendant = opener && activePanel.contains(opener) ? opener : null
    const parent = getTopLayer()
    const exitingOwner = pendingFocusReturns.findLast((entry) =>
      !opener || opener === document.body || entry.layer.contains(opener),
    )
    const returnTargets = [...new Set([
      ...(opener && opener !== document.body ? [opener] : []),
      ...(exitingOwner?.returnTargets ?? []),
      ...(parent?.returnTargets ?? []),
    ])]
    const unregister = registerLayer({
      layer: activeLayer,
      panel: activePanel,
      isOpen: () => logicalOpenRef.current,
      returnTargets,
    })

    if (!activePanel.contains(document.activeElement)) {
      const requestedTarget = initialFocusRefRef.current?.current
      const target = focusedDescendant ?? (requestedTarget?.matches(':disabled')
        ? null
        : requestedTarget ?? activePanel.querySelector<HTMLElement>('[data-modal-initial-focus]'))
      ;(target ?? activePanel).focus()
    }

    function handleKeyDown(event: KeyboardEvent) {
      // Document capture runs before the exiting root's React capture handler.
      // It must not redirect an event from a closed child into its open parent.
      if (isClosedLayerEvent(event)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      if (!isTopLayer(activeLayer)) return

      if (event.key === 'Escape' && closeOnEscapeRef.current) {
        if (event.target instanceof Element && event.target.closest('[role="menu"]')) return
        if (event.target instanceof Element && event.target.closest('[data-handle-escape]')) return
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
      activeLayer.dataset.modalState = 'closing'
      activeLayer.inert = true
      activeLayer.setAttribute('aria-hidden', 'true')
      restoreFocusRef.current = unregister()
    }
  }, [isOpen])

  useEffect(() => () => {
    // Unmount has no layout setup; return focus after DOM removal instead.
    restoreFocusRef.current?.()
    restoreFocusRef.current = undefined
  }, [])

  if ((!isOpen && (exitMotion === 'none' || !present)) || typeof document === 'undefined') return null

  const view = isOpen ? presentation : lastOpenPresentation.current
  function suppressClosedEvent(event: SyntheticEvent) {
    if (logicalOpenRef.current) return
    event.preventDefault()
    event.stopPropagation()
  }

  return createPortal(
    <div
      ref={layerRef}
      data-modal-state={isOpen ? 'open' : 'closing'}
      aria-hidden={isOpen ? undefined : true}
      className={`fixed inset-0 z-modal ${view.rootClassName} ${isOpen ? '' : 'pointer-events-none opacity-0 transition-opacity duration-standard ease-standard motion-reduce:transition-none'}`}
      onClickCapture={suppressClosedEvent}
      onPointerDownCapture={suppressClosedEvent}
      onChangeCapture={suppressClosedEvent}
      onInputCapture={suppressClosedEvent}
      onSubmitCapture={suppressClosedEvent}
      onKeyDownCapture={suppressClosedEvent}
      onKeyUpCapture={suppressClosedEvent}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={view.backdropLabel}
        disabled={!isOpen || !closeOnBackdrop}
        className={`absolute inset-0 ${view.backdropClassName}`}
        onClick={isOpen && closeOnBackdrop ? () => { if (logicalOpenRef.current) onCloseRef.current() } : undefined}
      />
      <div
        ref={panelRef}
        role={view.role}
        aria-modal={isOpen ? true : undefined}
        aria-label={view.ariaLabel}
        aria-labelledby={view.ariaLabelledBy}
        aria-describedby={view.ariaDescribedBy}
        tabIndex={-1}
        className={`focus:outline-none ${view.panelClassName ?? ''}`}
      >
        {view.children}
      </div>
    </div>,
    document.body,
  )
}
