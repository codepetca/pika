'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  type LayoutConfig,
  type RightSidebarWidth,
  type RouteKey,
  COOKIE_NAMES,
  DESKTOP_BREAKPOINT,
  getLayoutConfig,
  getRightSidebarCookieName,
  LEFT_SIDEBAR,
} from '@/lib/layout-config'
import { writeCookie } from '@/lib/cookies'

// ============================================================================
// Types
// ============================================================================

type LeftSidebarState = {
  isExpanded: boolean
  setExpanded: (expanded: boolean) => void
  toggle: () => void
}

type RightSidebarState = {
  isOpen: boolean
  width: RightSidebarWidth
  setOpen: (open: boolean) => void
  setWidth: (width: RightSidebarWidth) => void
  toggle: () => void
  desktopAlwaysOpen: boolean
}

type ThreePanelContextValue = {
  leftSidebar: LeftSidebarState
  rightSidebar: RightSidebarState
  config: LayoutConfig
  routeKey: RouteKey
  /** Width values in pixels for CSS */
  widths: {
    left: number
    right: string
  }
  /** For mobile drawer state */
  mobileDrawer: {
    isLeftOpen: boolean
    isRightOpen: boolean
    openLeft: () => void
    openRight: () => void
    close: () => void
  }
}

// ============================================================================
// Context
// ============================================================================

const ThreePanelContext = createContext<ThreePanelContextValue | null>(null)

// ============================================================================
// Provider Component
// ============================================================================

export interface ThreePanelProviderProps {
  children: ReactNode
  /** Route key determines layout config */
  routeKey: RouteKey
  /** Initial left sidebar state from cookie */
  initialLeftExpanded: boolean
  /** Initial right sidebar state from cookie (if enabled) */
  initialRightOpen?: boolean
}

export function ThreePanelProvider({
  children,
  routeKey,
  initialLeftExpanded,
  initialRightOpen,
}: ThreePanelProviderProps) {
  const config = useMemo(() => getLayoutConfig(routeKey), [routeKey])

  // Left sidebar state (global, persisted)
  const [leftExpanded, setLeftExpandedState] = useState(initialLeftExpanded)

  // Right sidebar state (per-view, persisted)
  const [rightOpen, setRightOpenState] = useState(() => {
    if (!config.rightSidebar.enabled) return false
    return initialRightOpen ?? config.rightSidebar.defaultOpen
  })
  const [rightWidth, setRightWidthState] = useState<RightSidebarWidth>(
    config.rightSidebar.defaultWidth
  )

  // Sync right sidebar state when routeKey (tab) changes
  useEffect(() => {
    setRightOpenState(config.rightSidebar.enabled && config.rightSidebar.defaultOpen)
    setRightWidthState(config.rightSidebar.defaultWidth)
  }, [routeKey, config])

  // Mobile drawer state
  const [mobileLeftOpen, setMobileLeftOpen] = useState(false)
  const [mobileRightOpen, setMobileRightOpen] = useState(false)

  // Track if we're on desktop for desktopAlwaysOpen behavior
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT)
    checkDesktop()
    window.addEventListener('resize', checkDesktop)
    return () => window.removeEventListener('resize', checkDesktop)
  }, [])

  // Force right sidebar open on desktop when desktopAlwaysOpen is true
  const desktopAlwaysOpen = config.rightSidebar.desktopAlwaysOpen ?? false
  const effectiveRightOpen = desktopAlwaysOpen && isDesktop ? true : rightOpen

  // Left sidebar handlers
  const setLeftExpanded = useCallback((expanded: boolean) => {
    setLeftExpandedState(expanded)
    writeCookie(COOKIE_NAMES.leftSidebar, expanded ? 'expanded' : 'collapsed')
  }, [])

  const toggleLeft = useCallback(() => {
    setLeftExpanded(!leftExpanded)
  }, [leftExpanded, setLeftExpanded])

  // Right sidebar handlers
  const setRightOpen = useCallback(
    (open: boolean) => {
      if (!config.rightSidebar.enabled) return
      setRightOpenState(open)
      writeCookie(getRightSidebarCookieName(routeKey), open ? 'open' : 'closed')
    },
    [config.rightSidebar.enabled, routeKey]
  )

  const setRightWidth = useCallback((width: RightSidebarWidth) => {
    setRightWidthState(width)
  }, [])

  const toggleRight = useCallback(() => {
    setRightOpen(!rightOpen)
  }, [rightOpen, setRightOpen])

  // Mobile drawer handlers
  const openMobileLeft = useCallback(() => {
    setMobileLeftOpen(true)
    setMobileRightOpen(false)
  }, [])

  const openMobileRight = useCallback(() => {
    if (!config.rightSidebar.enabled) return
    setMobileRightOpen(true)
    setMobileLeftOpen(false)
  }, [config.rightSidebar.enabled])

  const closeMobileDrawer = useCallback(() => {
    setMobileLeftOpen(false)
    setMobileRightOpen(false)
  }, [])

  // Calculate CSS widths
  const widths = useMemo(() => {
    const leftWidth = leftExpanded
      ? LEFT_SIDEBAR.expandedWidth
      : LEFT_SIDEBAR.collapsedWidth

    let rightWidthCss: string
    if (!config.rightSidebar.enabled || !effectiveRightOpen) {
      rightWidthCss = '0px'
    } else if (typeof rightWidth === 'string') {
      rightWidthCss = rightWidth // percentage values like '50%', '60%', '70%'
    } else {
      rightWidthCss = `${rightWidth}px`
    }

    return { left: leftWidth, right: rightWidthCss }
  }, [leftExpanded, config.rightSidebar.enabled, effectiveRightOpen, rightWidth])

  // Build context value
  const value = useMemo<ThreePanelContextValue>(
    () => ({
      leftSidebar: {
        isExpanded: leftExpanded,
        setExpanded: setLeftExpanded,
        toggle: toggleLeft,
      },
      rightSidebar: {
        isOpen: effectiveRightOpen,
        width: rightWidth,
        setOpen: setRightOpen,
        setWidth: setRightWidth,
        toggle: toggleRight,
        desktopAlwaysOpen,
      },
      config,
      routeKey,
      widths,
      mobileDrawer: {
        isLeftOpen: mobileLeftOpen,
        isRightOpen: mobileRightOpen,
        openLeft: openMobileLeft,
        openRight: openMobileRight,
        close: closeMobileDrawer,
      },
    }),
    [
      leftExpanded,
      setLeftExpanded,
      toggleLeft,
      effectiveRightOpen,
      rightWidth,
      setRightOpen,
      setRightWidth,
      toggleRight,
      desktopAlwaysOpen,
      config,
      routeKey,
      widths,
      mobileLeftOpen,
      mobileRightOpen,
      openMobileLeft,
      openMobileRight,
      closeMobileDrawer,
    ]
  )

  // Keyboard shortcuts: Cmd/Ctrl+\ for left panel, Cmd/Ctrl+Shift+\ for right panel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Check for Cmd (Mac) or Ctrl (Windows/Linux) + \
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        // Don't trigger if user is typing in an input/textarea
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return
        }

        e.preventDefault()

        if (e.shiftKey) {
          // Cmd/Ctrl+Shift+\: toggle right panel (skip if desktopAlwaysOpen on desktop)
          if (!(desktopAlwaysOpen && isDesktop)) {
            toggleRight()
          }
        } else {
          // Cmd/Ctrl+\: toggle left panel
          toggleLeft()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [toggleLeft, toggleRight, desktopAlwaysOpen, isDesktop])

  return (
    <ThreePanelContext.Provider value={value}>
      {children}
    </ThreePanelContext.Provider>
  )
}

// ============================================================================
// Hook
// ============================================================================

export function useThreePanel() {
  const ctx = useContext(ThreePanelContext)
  if (!ctx) {
    throw new Error('useThreePanel must be used within ThreePanelProvider')
  }
  return ctx
}

export function useLeftSidebar() {
  const { leftSidebar, widths } = useThreePanel()
  return { ...leftSidebar, width: widths.left }
}

export function useRightSidebar() {
  const { rightSidebar, config, widths } = useThreePanel()
  return {
    ...rightSidebar,
    enabled: config.rightSidebar.enabled,
    cssWidth: widths.right,
    desktopAlwaysOpen: rightSidebar.desktopAlwaysOpen,
  }
}

export function useMobileDrawer() {
  const { mobileDrawer } = useThreePanel()
  return mobileDrawer
}
