import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGradebookEmail2 } from '@/hooks/useGradebookEmail2'
import { getGradebookEmail2Addresses } from '@/lib/gradebook-email'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'

afterEach(() => { invalidateCachedJSONMatching('teacher-roster:'); vi.unstubAllGlobals() })

describe('Gradebook Email 2', () => {
  it('copies only selected stable bindings, skipping blanks and duplicates', () => {
    expect(getGradebookEmail2Addresses([
      { student_id: 's1', counselor_email: 'Shared@school.ca' },
      { student_id: 's2', counselor_email: ' shared@school.ca ' },
      { student_id: 's3', counselor_email: null },
      { student_id: 's4', counselor_email: 'unselected@school.ca' },
      { student_id: null, counselor_email: 'unbound@school.ca' },
    ], new Set(['s1', 's2', 's3']))).toEqual(['Shared@school.ca'])
  })

  it('prefetches and refreshes addresses on reactivation', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ roster: [{ student_id: 's1', counselor_email: 'first@school.ca' }] }) })
      .mockResolvedValue({ ok: true, json: async () => ({ roster: [{ student_id: 's1', counselor_email: 'updated@school.ca' }] }) })
    vi.stubGlobal('fetch', fetchMock)
    const { result, rerender } = renderHook(({ active }) => useGradebookEmail2('c1', active), { initialProps: { active: true } })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.rows[0].counselor_email).toBe('first@school.ca')
    rerender({ active: false })
    rerender({ active: true })
    await waitFor(() => expect(result.current.rows[0]?.counselor_email).toBe('updated@school.ca'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('exposes load failure and retries without making the grade table unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('Roster unavailable'))
      .mockResolvedValue({ ok: true, json: async () => ({ roster: [] }) }))
    const { result } = renderHook(() => useGradebookEmail2('c1', true))
    await waitFor(() => expect(result.current.error).toBe('Roster unavailable'))
    await act(async () => { await result.current.reload() })
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.rows).toEqual([])
  })

  it('hides and fences addresses from a previous classroom', async () => {
    let resolveFirst!: (response: unknown) => void
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValue({ ok: true, json: async () => ({ roster: [{ student_id: 's2', counselor_email: 'second@school.ca' }] }) }))
    const { result, rerender } = renderHook(({ id }) => useGradebookEmail2(id, true), { initialProps: { id: 'c1' } })
    rerender({ id: 'c2' })
    expect(result.current.rows).toEqual([])
    await waitFor(() => expect(result.current.rows[0]?.student_id).toBe('s2'))
    await act(async () => { resolveFirst({ ok: true, json: async () => ({ roster: [{ student_id: 's1', counselor_email: 'old@school.ca' }] }) }) })
    expect(result.current.rows[0].student_id).toBe('s2')
  })
})
