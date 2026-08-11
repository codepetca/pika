import { useCallback, useEffect, useState } from 'react'

export function useTableSelection(rowIds: string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setSelectedIds((previous) => {
      const visibleIds = new Set(rowIds)
      const filtered = new Set([...previous].filter((id) => visibleIds.has(id)))
      if (filtered.size === previous.size) return previous
      return filtered
    })
  }, [rowIds])

  const allSelected = rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id))
  const selectedCount = selectedIds.size
  const someSelected = selectedCount > 0 && !allSelected

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((previous) => {
      const everyVisibleRowSelected = rowIds.length > 0 && rowIds.every((id) => previous.has(id))
      return everyVisibleRowSelected ? new Set() : new Set(rowIds)
    })
  }, [rowIds])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])
  const setSelection = useCallback((ids: Iterable<string>) => setSelectedIds(new Set(ids)), [])

  return {
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    allSelected,
    someSelected,
    clearSelection,
    setSelection,
    selectedCount,
  }
}
