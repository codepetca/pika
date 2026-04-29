'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const MARKDOWN_PREFERENCE_STORAGE_KEY = 'pika_show_markdown'

interface MarkdownPreferenceContextValue {
  showMarkdown: boolean
  mounted: boolean
  setShowMarkdown: (show: boolean) => void
  toggleShowMarkdown: () => void
}

const MarkdownPreferenceContext = createContext<MarkdownPreferenceContextValue>({
  showMarkdown: true,
  mounted: false,
  setShowMarkdown: () => {},
  toggleShowMarkdown: () => {},
})

function readStoredShowMarkdown(): boolean {
  try {
    return localStorage.getItem(MARKDOWN_PREFERENCE_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function MarkdownPreferenceProvider({ children }: { children: ReactNode }) {
  const [showMarkdown, setShowMarkdownState] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setShowMarkdownState(readStoredShowMarkdown())
    setMounted(true)
  }, [])

  const setShowMarkdown = (show: boolean) => {
    setShowMarkdownState(show)
    try {
      localStorage.setItem(MARKDOWN_PREFERENCE_STORAGE_KEY, show ? 'true' : 'false')
    } catch {
      // Ignore storage errors; the in-memory preference still updates for this session.
    }
  }

  const value = useMemo<MarkdownPreferenceContextValue>(
    () => ({
      showMarkdown,
      mounted,
      setShowMarkdown,
      toggleShowMarkdown: () => setShowMarkdown(!showMarkdown),
    }),
    [mounted, showMarkdown],
  )

  return (
    <MarkdownPreferenceContext.Provider value={value}>
      {children}
    </MarkdownPreferenceContext.Provider>
  )
}

export function useMarkdownPreference() {
  return useContext(MarkdownPreferenceContext)
}
