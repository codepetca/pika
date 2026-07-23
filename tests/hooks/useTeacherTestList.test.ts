import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTeacherTestList } from '@/hooks/useTeacherTestList'
import { TEACHER_TESTS_UPDATED_EVENT } from '@/lib/events'
import { invalidateCachedJSON } from '@/lib/request-cache'
import { createMockTest } from '../helpers/mocks'
import type { TestAssessmentWithStats } from '@/types'

function makeTest(overrides: Partial<TestAssessmentWithStats> = {}): TestAssessmentWithStats {
  return {
    ...createMockTest({
      assessment_type: 'test',
      status: 'draft',
      ...overrides,
    }),
    assessment_type: 'test',
    stats: {
      total_students: 10,
      responded: 5,
      submitted: 2,
      open_access: 0,
      closed_access: 0,
      questions_count: 3,
      ...overrides.stats,
    },
    ...overrides,
  } as TestAssessmentWithStats
}

describe('useTeacherTestList', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    invalidateCachedJSON('teacher-tests:classroom-1')
    invalidateCachedJSON('teacher-tests:classroom-2')
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    invalidateCachedJSON('teacher-tests:classroom-1')
    invalidateCachedJSON('teacher-tests:classroom-2')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads tests for the current classroom', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test' })] }),
    })

    const { result } = renderHook(() =>
      useTeacherTestList({
        classroomId: 'classroom-1',
        selectedTestId: null,
        selectedTestDraftSummary: null,
      }),
    )

    expect(fetchMock).toHaveBeenCalledWith('/api/teacher/tests?classroom_id=classroom-1', undefined)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.tests).toHaveLength(1)
    expect(result.current.visibleTests.map((test) => test.title)).toEqual(['Unit Test'])
  })

  it('reports a cold load failure without treating it as an empty snapshot', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Database unavailable' }),
    })

    const { result } = renderHook(() =>
      useTeacherTestList({
        classroomId: 'classroom-1',
        selectedTestId: null,
        selectedTestDraftSummary: null,
      }),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('Database unavailable')
    expect(result.current.hasLoadedSnapshot).toBe(false)
    expect(result.current.visibleTests).toEqual([])
  })

  it('preserves a valid snapshot when refresh fails and retries explicitly', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Current Test' })] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Refresh failed' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-2', title: 'Recovered Test' })] }),
      })

    const { result } = renderHook(() =>
      useTeacherTestList({
        classroomId: 'classroom-1',
        selectedTestId: null,
        selectedTestDraftSummary: null,
      }),
    )

    await waitFor(() => expect(result.current.visibleTests.map((test) => test.title)).toEqual(['Current Test']))

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TEACHER_TESTS_UPDATED_EVENT, { detail: { classroomId: 'classroom-1' } }),
      )
    })

    await waitFor(() => expect(result.current.error).toBe('Refresh failed'))
    expect(result.current.hasLoadedSnapshot).toBe(true)
    expect(result.current.visibleTests.map((test) => test.title)).toEqual(['Current Test'])

    await act(async () => {
      await result.current.retryTests()
    })

    expect(result.current.error).toBeNull()
    expect(result.current.visibleTests.map((test) => test.title)).toEqual(['Recovered Test'])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('hides prior classroom tests while the next classroom is loading', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Class A Test' })] }),
    })

    const { result, rerender } = renderHook(
      ({ classroomId }: { classroomId: string }) =>
        useTeacherTestList({
          classroomId,
          selectedTestId: null,
          selectedTestDraftSummary: null,
        }),
      { initialProps: { classroomId: 'classroom-1' } },
    )

    await waitFor(() => expect(result.current.visibleTests.map((test) => test.title)).toEqual(['Class A Test']))

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tests: [makeTest({ id: 'test-2', title: 'Class B Test' })] }),
    })

    rerender({ classroomId: 'classroom-2' })

    expect(result.current.visibleTests).toEqual([])
    await waitFor(() => expect(result.current.visibleTests.map((test) => test.title)).toEqual(['Class B Test']))
  })

  it('ignores late responses from a previous classroom', async () => {
    type PendingRequest = {
      url: string
      resolve: (value: { ok: boolean; json: () => Promise<{ tests: TestAssessmentWithStats[] }> }) => void
    }
    const pending: PendingRequest[] = []

    fetchMock.mockImplementation((url: string) => (
      new Promise((resolve) => {
        pending.push({ url, resolve: resolve as PendingRequest['resolve'] })
      })
    ))

    function resolveTests(classroomId: string, tests: TestAssessmentWithStats[]) {
      const request = pending.find((item) => item.url === `/api/teacher/tests?classroom_id=${classroomId}`)
      expect(request).toBeTruthy()
      request?.resolve({
        ok: true,
        json: async () => ({ tests }),
      })
    }

    const { result, rerender } = renderHook(
      ({ classroomId }: { classroomId: string }) =>
        useTeacherTestList({
          classroomId,
          selectedTestId: null,
          selectedTestDraftSummary: null,
        }),
      { initialProps: { classroomId: 'classroom-1' } },
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/teacher/tests?classroom_id=classroom-1', undefined)
    })

    rerender({ classroomId: 'classroom-2' })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/teacher/tests?classroom_id=classroom-2', undefined)
    })

    await act(async () => {
      resolveTests('classroom-2', [makeTest({ id: 'test-b', title: 'Class B Test' })])
      await Promise.resolve()
    })

    expect(result.current.visibleTests.map((test) => test.title)).toEqual(['Class B Test'])

    await act(async () => {
      resolveTests('classroom-1', [makeTest({ id: 'test-a', title: 'Class A Test' })])
      await Promise.resolve()
    })

    expect(result.current.visibleTests.map((test) => test.title)).toEqual(['Class B Test'])
  })

  it('reloads only for matching classroom update events', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Initial Test' })] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-2', title: 'Reloaded Test' })] }),
      })

    const { result } = renderHook(() =>
      useTeacherTestList({
        classroomId: 'classroom-1',
        selectedTestId: null,
        selectedTestDraftSummary: null,
      }),
    )

    await waitFor(() => expect(result.current.visibleTests.map((test) => test.title)).toEqual(['Initial Test']))

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TEACHER_TESTS_UPDATED_EVENT, { detail: { classroomId: 'classroom-2' } }),
      )
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TEACHER_TESTS_UPDATED_EVENT, { detail: { classroomId: 'classroom-1' } }),
      )
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.visibleTests.map((test) => test.title)).toEqual(['Reloaded Test']))
  })

  it('applies the current selected draft summary to reloaded tests', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Original Test' })] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Server Test' })] }),
      })

    const { result, rerender } = renderHook(
      ({ selectedTestDraftSummary }: Pick<Parameters<typeof useTeacherTestList>[0], 'selectedTestDraftSummary'>) =>
        useTeacherTestList({
          classroomId: 'classroom-1',
          selectedTestId: 'test-1',
          selectedTestDraftSummary,
        }),
      { initialProps: { selectedTestDraftSummary: null } },
    )

    await waitFor(() => expect(result.current.visibleTests.map((test) => test.title)).toEqual(['Original Test']))

    rerender({
      selectedTestDraftSummary: {
        title: 'Draft Title',
        show_results: false,
        questions_count: 7,
      },
    })

    await act(async () => {
      await result.current.loadTests()
    })

    expect(result.current.visibleTests[0]).toMatchObject({
      title: 'Draft Title',
      show_results: false,
      stats: expect.objectContaining({ questions_count: 7 }),
    })
  })
})
