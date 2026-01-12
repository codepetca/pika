'use client'

import { createContext, useContext, type ReactNode } from 'react'

type LayoutInitialState = {
  leftSidebarExpanded: boolean
}

const LayoutInitialStateContext = createContext<LayoutInitialState | null>(null)

export function LayoutInitialStateProvider({
  children,
  leftSidebarExpanded,
}: {
  children: ReactNode
  leftSidebarExpanded: boolean
}) {
  return (
    <LayoutInitialStateContext.Provider value={{ leftSidebarExpanded }}>
      {children}
    </LayoutInitialStateContext.Provider>
  )
}

export function useLayoutInitialState() {
  const ctx = useContext(LayoutInitialStateContext)
  if (!ctx) {
    throw new Error('useLayoutInitialState must be used within LayoutInitialStateProvider')
  }
  return ctx
}
