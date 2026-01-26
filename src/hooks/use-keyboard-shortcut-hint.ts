'use client'

import { useMemo } from 'react'

/**
 * Returns keyboard shortcut hints formatted for the current platform.
 * Uses ⌘ for Mac, Ctrl for Windows/Linux.
 */
export function useKeyboardShortcutHint() {
  const isMac = useMemo(() => {
    if (typeof window === 'undefined') return false
    return navigator.platform.toUpperCase().indexOf('MAC') >= 0
  }, [])

  const mod = isMac ? '⌘' : 'Ctrl+'

  return {
    /** Modifier key symbol (⌘ or Ctrl+) */
    mod,
    /** Left sidebar toggle: ⌘\ or Ctrl+\ */
    leftPanel: `${mod}\\`,
    /** Right sidebar toggle: ⌘⇧\ or Ctrl+Shift+\ */
    rightPanel: isMac ? '⌘⇧\\' : 'Ctrl+Shift+\\',
  }
}
