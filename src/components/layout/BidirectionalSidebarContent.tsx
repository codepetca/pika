'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'

/**
 * Props for BidirectionalSidebarContent
 */
export interface BidirectionalSidebarContentProps<T> {
  /** Current content from parent */
  content: T
  /** Error message if any */
  error: string | null
  /** Whether save is in progress */
  saving: boolean
  /** Handler for content changes */
  onChange: (content: T) => void
  /** Handler to trigger save */
  onSave: () => void
  /** Render function for the content editor */
  children: (props: {
    localContent: T
    onLocalChange: (content: T) => void
    onKeyDown: (e: React.KeyboardEvent) => void
  }) => ReactNode
}

/**
 * Wrapper component for bidirectional sidebar content that manages local state
 * to prevent cursor jumping during edits.
 *
 * Uses local state that syncs with parent content, but updates are debounced
 * through the onChange callback. Supports Cmd/Ctrl+S to save.
 *
 * @example
 * ```tsx
 * <BidirectionalSidebarContent
 *   content={sidebarState.content}
 *   error={sidebarState.error}
 *   saving={sidebarState.saving}
 *   onChange={sidebarState.onChange}
 *   onSave={sidebarState.onSave}
 * >
 *   {({ localContent, onLocalChange, onKeyDown }) => (
 *     <textarea
 *       value={localContent}
 *       onChange={(e) => onLocalChange(e.target.value)}
 *       onKeyDown={onKeyDown}
 *     />
 *   )}
 * </BidirectionalSidebarContent>
 * ```
 */
export function BidirectionalSidebarContent<T>({
  content,
  error,
  saving,
  onChange,
  onSave,
  children,
}: BidirectionalSidebarContentProps<T>) {
  // Local state to prevent cursor jumping
  const [localContent, setLocalContent] = useState<T>(content)

  // Sync local state when content changes from parent (e.g., on sidebar reopen)
  useEffect(() => {
    setLocalContent(content)
  }, [content])

  // Handle local content change
  const handleLocalChange = useCallback(
    (newContent: T) => {
      setLocalContent(newContent)
      onChange(newContent)
    },
    [onChange]
  )

  // Handle keyboard shortcuts (Cmd/Ctrl+S to save)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (!saving) {
          onSave()
        }
      }
    },
    [saving, onSave]
  )

  return (
    <div className="flex flex-col h-full">
      {error && (
        <div className="mx-2 mt-2 p-2 rounded bg-danger-bg text-sm text-danger whitespace-pre-wrap">
          {error}
        </div>
      )}
      {children({
        localContent,
        onLocalChange: handleLocalChange,
        onKeyDown: handleKeyDown,
      })}
    </div>
  )
}
