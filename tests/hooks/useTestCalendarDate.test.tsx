import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestCalendarDate } from '@/hooks/useTestCalendarDate'
import { createMockTest } from '../helpers/mocks'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'
import { TEACHER_TESTS_UPDATED_EVENT } from '@/lib/events'

describe('Test calendar date saves', () => {
  const test = createMockTest({ test_date: null })
  const options = { test, classroomId: test.classroom_id, apiBasePath: '/api/teacher/tests', onSaved: vi.fn() }
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); options.onSaved.mockClear() })
  afterEach(() => { vi.unstubAllGlobals() })
  const response = (date: string | null) => ({ ok: true, json: async () => ({ test: { ...test, test_date: date } }) })

  it('lets the date be edited without persisting intermediate year values', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response('2026-11-08') as Response)
    const { result } = renderHook(() => useTestCalendarDate(options))
    act(() => result.current.edit('0002-11-08'))
    expect(result.current.saving).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    act(() => result.current.edit('2026-11-08'))
    await act(async () => { expect(await result.current.flush()).toBe(true) })
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ test_date: '2026-11-08' })
    expect(result.current.dirty).toBe(false)
  })

  it('blocks close/publish flush for incomplete native input without clearing a saved date', async () => {
    const { result } = renderHook(() => useTestCalendarDate({ ...options, test: { ...test, test_date: '2026-11-08' } }))
    act(() => result.current.edit('', false))
    await act(async () => { expect(await result.current.flush()).toBe(false) })
    expect(result.current.error).toBe('Enter a complete test date')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('saves and clears calendar metadata without changing publication or drafts', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response('2026-11-08') as Response).mockResolvedValueOnce(response(null) as Response)
    const { result } = renderHook(() => useTestCalendarDate(options))
    await act(async () => { expect(await result.current.save('2026-11-08')).toBe(true) })
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ test_date: '2026-11-08' })
    await act(async () => { expect(await result.current.save('')).toBe(true) })
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toEqual({ test_date: null })
    expect(options.onSaved).toHaveBeenCalledTimes(2)
  })

  it('invalidates the calendar cache before callback and Tests listeners refresh', async () => {
    const key = `teacher-tests:${test.classroom_id}`
    const oldList = { tests: [{ ...test, test_date: '2026-11-01' }] }
    const freshList = { tests: [{ ...test, test_date: '2026-11-08' }] }
    await fetchJSONWithCache(key, async () => oldList, 20_000)
    const reads: Array<Promise<typeof freshList>> = []
    const loadTests = () => { reads.push(fetchJSONWithCache(key, async () => freshList, 0)) }
    const calendarListener = () => { invalidateCachedJSON(key); loadTests() }
    window.addEventListener(TEACHER_TESTS_UPDATED_EVENT, loadTests)
    window.addEventListener(TEACHER_TESTS_UPDATED_EVENT, calendarListener)
    try {
      vi.mocked(fetch).mockResolvedValueOnce(response('2026-11-08') as Response)
      const { result } = renderHook(() => useTestCalendarDate({ ...options, onSaved: loadTests }))
      await act(async () => { expect(await result.current.save('2026-11-08')).toBe(true) })
      expect(reads).toHaveLength(3)
      expect(await Promise.all(reads)).toEqual([freshList, freshList, freshList])
    } finally {
      window.removeEventListener(TEACHER_TESTS_UPDATED_EVENT, loadTests)
      window.removeEventListener(TEACHER_TESTS_UPDATED_EVENT, calendarListener)
      invalidateCachedJSON(key)
    }
  })

  it('keeps a failed date visible and retries it during close/publish flush', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Try again' }) } as Response)
      .mockResolvedValueOnce(response('2026-11-08') as Response)
    const { result } = renderHook(() => useTestCalendarDate(options))
    await act(async () => { expect(await result.current.save('2026-11-08')).toBe(false) })
    expect(result.current.value).toBe('2026-11-08')
    expect(result.current.error).toBe('Try again')
    await act(async () => { expect(await result.current.flush()).toBe(true) })
    expect(result.current.error).toBe('')
  })

  it('waits for an in-flight date save before flushing', async () => {
    let resolve!: (value: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>(done => { resolve = done }))
    const { result } = renderHook(() => useTestCalendarDate(options))
    let saved!: Promise<boolean>
    act(() => { saved = result.current.save('2026-11-08') })
    expect(result.current.saving).toBe(true)
    expect(result.current.flush()).toBe(saved)
    await act(async () => { resolve(response('2026-11-08') as Response); await saved })
    expect(result.current.saving).toBe(false)
  })

  it('fences late date saves after switching Test or Classroom', async () => {
    let resolve!: (value: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>(done => { resolve = done }))
    const { result, rerender } = renderHook(props => useTestCalendarDate(props), { initialProps: options })
    let pending!: Promise<boolean>
    act(() => { pending = result.current.save('2026-11-08') })
    rerender({ ...options, test: { ...test, id: 'other-test', test_date: '2026-12-01' } })
    await act(async () => { resolve(response('2026-11-08') as Response); expect(await pending).toBe(false) })
    await waitFor(() => expect(result.current.value).toBe('2026-12-01'))
    expect(options.onSaved).not.toHaveBeenCalled()
  })
})
