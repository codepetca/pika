import { useCallback, useEffect, useState } from 'react'

export function useStudentSelection(rowIds: string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Clear stale selections when rowIds change
  useEffect(() => {
    setSelectedIds((prev) => {
      const rowIdSet = new Set(rowIds)
      const filtered = new Set([...prev].filter((id) => rowIdSet.has(id)))
      if (filtered.size === prev.size) return prev
      return filtered
    })
  }, [rowIds])

  const allSelected = rowIds.length > 0 && selectedIds.size === rowIds.length
  const selectedCount = selectedIds.size

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === rowIds.length) {
        return new Set()
      }
      return new Set(rowIds)
    })
  }, [rowIds])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  return {
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    allSelected,
    clearSelection,
    selectedCount,
  }
}
