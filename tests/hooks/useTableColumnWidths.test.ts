import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTableColumnWidths } from '@/hooks/useTableColumnWidths'

const columns = {
  first: { defaultWidth: 72, min: 60, max: 160 },
  status: { defaultWidth: 80, min: 70, max: 110 },
} as const

describe('useTableColumnWidths', () => {
  beforeEach(() => window.localStorage.clear())

  it('clamps updates and persists width-only preferences', async () => {
    const { result } = renderHook(() => useTableColumnWidths({
      storageKey: 'assignment-students:v1',
      columns,
    }))

    act(() => result.current.setColumnWidth('first', 999))
    expect(result.current.columnWidths.first).toBe(160)

    await waitFor(() => {
      expect(window.localStorage.getItem('pika:table-widths:assignment-students:v1')).toBe(
        JSON.stringify({ first: 160, status: 80 }),
      )
    })
  })

  it('loads valid stored widths and ignores invalid values', async () => {
    window.localStorage.setItem(
      'pika:table-widths:roster:v1',
      JSON.stringify({ first: 100, status: 'wide', ignored: 500 }),
    )

    const { result } = renderHook(() => useTableColumnWidths({
      storageKey: 'roster:v1',
      columns,
    }))

    await waitFor(() => {
      expect(result.current.columnWidths).toEqual({ first: 100, status: 80 })
    })
  })

  it('resets all columns to their table-owned defaults', () => {
    const { result } = renderHook(() => useTableColumnWidths({
      storageKey: null,
      columns,
    }))

    act(() => result.current.setColumnWidth('first', 120))
    act(() => result.current.resetColumnWidths())

    expect(result.current.columnWidths).toEqual({ first: 72, status: 80 })
  })
})
