import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useTableSelection } from '@/hooks/useTableSelection'

describe('useTableSelection', () => {
  it('tracks partial and complete selection across visible row ids', () => {
    const { result } = renderHook(() => useTableSelection(['student-1', 'student-2']))

    act(() => result.current.toggleSelect('student-1'))
    expect(result.current.selectedCount).toBe(1)
    expect(result.current.someSelected).toBe(true)
    expect(result.current.allSelected).toBe(false)

    act(() => result.current.toggleSelectAll())
    expect(result.current.selectedIds).toEqual(new Set(['student-1', 'student-2']))
    expect(result.current.someSelected).toBe(false)
    expect(result.current.allSelected).toBe(true)
  })

  it('removes selections that are no longer in the visible row set', () => {
    const { result, rerender } = renderHook(
      ({ rowIds }) => useTableSelection(rowIds),
      { initialProps: { rowIds: ['student-1', 'student-2'] } },
    )

    act(() => result.current.setSelection(['student-1', 'student-2']))
    rerender({ rowIds: ['student-2'] })

    expect(result.current.selectedIds).toEqual(new Set(['student-2']))
    expect(result.current.allSelected).toBe(true)
  })
})
