'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRightSidebar } from '@/components/layout'

const DEFAULT_SYNC_DEBOUNCE_MS = 300

/**
 * State passed to parent component for rendering in RightSidebar
 */
export interface BidirectionalSidebarState<T> {
  /** Current content value */
  content: T
  /** Error message if any */
  error: string | null
  /** Whether save is in progress */
  saving: boolean
  /** Handler for content changes */
  onChange: (content: T) => void
  /** Handler to trigger save */
  onSave: () => void
}

/**
 * Options for useBidirectionalSidebar hook
 */
export interface UseBidirectionalSidebarOptions<T> {
  /** Function to load content when sidebar opens */
  loadContent: () => Promise<T>
  /** Function to save content */
  saveContent: (content: T) => Promise<{ success: boolean; error?: string }>
  /** Initial content value */
  initialContent: T
  /** Debounce delay for content sync in ms (default: 300) */
  syncDebounceMs?: number
  /** Whether to close sidebar after successful save (default: true) */
  closeOnSave?: boolean
  /** Callback when save succeeds */
  onSaveSuccess?: () => void
}

/**
 * Hook for managing bidirectional sidebar content editing.
 * Handles loading content when sidebar opens, tracking changes with refs to avoid
 * stale closures, debounced state updates, and save functionality.
 *
 * @example
 * ```tsx
 * const sidebar = useBidirectionalSidebar({
 *   loadContent: async () => {
 *     const res = await fetch('/api/content')
 *     return res.json()
 *   },
 *   saveContent: async (content) => {
 *     const res = await fetch('/api/content', { method: 'PUT', body: JSON.stringify(content) })
 *     return { success: res.ok }
 *   },
 *   initialContent: '',
 * })
 *
 * // Pass state to parent for rendering in RightSidebar
 * onSidebarStateChange(sidebar.isOpen ? sidebar.state : null)
 * ```
 */
export function useBidirectionalSidebar<T>({
  loadContent,
  saveContent,
  initialContent,
  syncDebounceMs = DEFAULT_SYNC_DEBOUNCE_MS,
  closeOnSave = true,
  onSaveSuccess,
}: UseBidirectionalSidebarOptions<T>) {
  const { isOpen, setOpen, toggle } = useRightSidebar()

  // Content state
  const [content, setContent] = useState<T>(initialContent)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Refs for avoiding stale closures and tracking state
  const contentRef = useRef<T>(initialContent)
  const prevOpenRef = useRef(false)
  const needsRefreshRef = useRef(true)
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Load content when sidebar opens
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const loaded = await loadContent()
      setContent(loaded)
      contentRef.current = loaded
      needsRefreshRef.current = false
    } catch (err) {
      console.error('Error loading sidebar content:', err)
      setError(err instanceof Error ? err.message : 'Failed to load content')
    } finally {
      setLoading(false)
    }
  }, [loadContent])

  // Auto-load when sidebar opens
  useEffect(() => {
    const wasOpen = prevOpenRef.current
    prevOpenRef.current = isOpen

    if (isOpen && !wasOpen && needsRefreshRef.current) {
      load()
    }
  }, [isOpen, load])

  // Handle content change - ref updates immediately, state debounced
  const handleChange = useCallback(
    (newContent: T) => {
      // Always update ref immediately so save has latest content
      contentRef.current = newContent

      // Debounce state update to reduce re-renders
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }
      syncTimeoutRef.current = setTimeout(() => {
        setContent(newContent)
      }, syncDebounceMs)
    },
    [syncDebounceMs]
  )

  // Handle save
  const handleSave = useCallback(async () => {
    setError(null)
    setSaving(true)

    try {
      const result = await saveContent(contentRef.current)

      if (!result.success) {
        setError(result.error || 'Failed to save')
        return
      }

      // Success
      needsRefreshRef.current = true
      if (closeOnSave) {
        setOpen(false)
      }
      onSaveSuccess?.()
    } catch (err) {
      console.error('Error saving sidebar content:', err)
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [saveContent, closeOnSave, setOpen, onSaveSuccess])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }
    }
  }, [])

  // Build state object for parent
  const state: BidirectionalSidebarState<T> = {
    content,
    error,
    saving,
    onChange: handleChange,
    onSave: handleSave,
  }

  return {
    /** Whether sidebar is open */
    isOpen,
    /** Toggle sidebar open/close */
    toggle,
    /** Open sidebar */
    open: useCallback(() => setOpen(true), [setOpen]),
    /** Close sidebar */
    close: useCallback(() => setOpen(false), [setOpen]),
    /** Whether content is loading */
    loading,
    /** State object to pass to parent for rendering */
    state,
    /** Force refresh on next open */
    markStale: useCallback(() => {
      needsRefreshRef.current = true
    }, []),
  }
}
