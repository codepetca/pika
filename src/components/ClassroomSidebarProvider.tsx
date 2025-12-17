'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { clampClassroomSidebarWidth } from '@/lib/classroom-sidebar'

type SidebarState = {
  isCollapsed: boolean
  setCollapsed: (next: boolean) => void
  toggleCollapsed: () => void
  expandedWidth: number
  setExpandedWidth: (next: number, opts?: { persist?: boolean }) => void
}

const SidebarContext = createContext<SidebarState | null>(null)

function writeCookie(name: string, value: string) {
  const oneYearSeconds = 60 * 60 * 24 * 365
  let cookie = `${name}=${value}; Path=/; Max-Age=${oneYearSeconds}; SameSite=Lax`
  if (process.env.NODE_ENV === 'production') cookie += '; Secure'
  document.cookie = cookie
}

export function ClassroomSidebarProvider({
  initialCollapsed,
  initialExpandedWidth,
  children,
}: {
  initialCollapsed: boolean
  initialExpandedWidth: number
  children: ReactNode
}) {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(initialCollapsed)
  const [expandedWidth, setExpandedWidthState] = useState<number>(
    clampClassroomSidebarWidth(initialExpandedWidth)
  )

  const setCollapsed = useCallback((next: boolean) => {
    setIsCollapsed(next)
    writeCookie('pika_sidebar', next ? 'collapsed' : 'expanded')
  }, [])

  const toggleCollapsed = useCallback(() => {
    setCollapsed(!isCollapsed)
  }, [isCollapsed, setCollapsed])

  const setExpandedWidth = useCallback(
    (next: number, opts?: { persist?: boolean }) => {
      const clamped = clampClassroomSidebarWidth(next)
      setExpandedWidthState(clamped)
      if (opts?.persist) writeCookie('pika_sidebar_w', String(clamped))
    },
    []
  )

  const value = useMemo<SidebarState>(
    () => ({ isCollapsed, setCollapsed, toggleCollapsed, expandedWidth, setExpandedWidth }),
    [isCollapsed, setCollapsed, toggleCollapsed, expandedWidth, setExpandedWidth]
  )

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

export function useClassroomSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) {
    throw new Error('useClassroomSidebar must be used within ClassroomSidebarProvider')
  }
  return ctx
}
