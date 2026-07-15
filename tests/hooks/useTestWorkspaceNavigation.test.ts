import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTestWorkspaceNavigation } from '@/hooks/useTestWorkspaceNavigation'

describe('useTestWorkspaceNavigation', () => {
  it('defaults to the tests list in grading mode', () => {
    const { result } = renderHook(() => useTestWorkspaceNavigation({}))

    expect(result.current.workspaceState).toBe('list')
    expect(result.current.selectedTestId).toBeNull()
    expect(result.current.selectedWorkspaceTab).toBe('grading')
    expect(result.current.selectedStudentId).toBeNull()
  })

  it('navigates to grading and writes test search params', () => {
    const updateSearchParams = vi.fn()
    const { result } = renderHook(() => useTestWorkspaceNavigation({ updateSearchParams }))

    act(() => {
      result.current.navigateTestWorkspace({
        testId: 'test-1',
        mode: 'grading',
        studentId: 'student-1',
      })
    })

    expect(result.current.workspaceState).toBe('selected')
    expect(result.current.selectedTestId).toBe('test-1')
    expect(result.current.selectedWorkspaceTab).toBe('grading')
    expect(result.current.selectedStudentId).toBe('student-1')
    expect(updateSearchParams).toHaveBeenCalledWith(expect.any(Function), undefined)

    const params = new URLSearchParams()
    updateSearchParams.mock.calls[0][0](params)
    expect(params.get('tab')).toBe('tests')
    expect(params.get('testId')).toBe('test-1')
    expect(params.get('testMode')).toBe('grading')
    expect(params.get('testStudentId')).toBe('student-1')
  })

  it('drops student params outside grading mode', () => {
    const updateSearchParams = vi.fn()
    const { result } = renderHook(() => useTestWorkspaceNavigation({ updateSearchParams }))

    act(() => {
      result.current.navigateTestWorkspace({
        testId: 'test-1',
        mode: 'authoring',
        studentId: 'student-1',
      })
    })

    expect(result.current.selectedWorkspaceTab).toBe('authoring')

    const params = new URLSearchParams('testStudentId=student-1')
    updateSearchParams.mock.calls[0][0](params)
    expect(params.get('testId')).toBe('test-1')
    expect(params.get('testMode')).toBe('authoring')
    expect(params.get('testStudentId')).toBeNull()
  })

  it('clears test params with replace options', () => {
    const updateSearchParams = vi.fn()
    const { result } = renderHook(() => useTestWorkspaceNavigation({ updateSearchParams }))

    act(() => {
      result.current.navigateTestWorkspace({ testId: 'test-1', mode: 'grading', studentId: 'student-1' })
    })
    act(() => {
      result.current.clearTestWorkspace({ replace: true })
    })

    expect(result.current.workspaceState).toBe('list')
    expect(result.current.selectedTestId).toBeNull()
    expect(result.current.selectedWorkspaceTab).toBe('grading')
    expect(result.current.selectedStudentId).toBeNull()
    expect(updateSearchParams).toHaveBeenLastCalledWith(expect.any(Function), { replace: true })

    const params = new URLSearchParams('tab=tests&testId=test-1&testMode=grading&testStudentId=student-1')
    updateSearchParams.mock.calls[1][0](params)
    expect(params.get('tab')).toBe('tests')
    expect(params.get('testId')).toBeNull()
    expect(params.get('testMode')).toBeNull()
    expect(params.get('testStudentId')).toBeNull()
  })

  it('lets controlled props override internal navigation state', () => {
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useTestWorkspaceNavigation>[0]) =>
        useTestWorkspaceNavigation(props),
      {
        initialProps: {
          selectedTestId: null,
          selectedTestMode: null,
          selectedTestStudentId: null,
        },
      },
    )

    act(() => {
      result.current.navigateTestWorkspace({ testId: 'internal-test', mode: 'grading', studentId: 'student-1' })
    })

    expect(result.current.workspaceState).toBe('list')
    expect(result.current.selectedTestId).toBeNull()
    expect(result.current.selectedStudentId).toBeNull()

    rerender({
      selectedTestId: 'controlled-test',
      selectedTestMode: 'authoring',
      selectedTestStudentId: 'controlled-student',
    })

    expect(result.current.workspaceState).toBe('selected')
    expect(result.current.selectedTestId).toBe('controlled-test')
    expect(result.current.selectedWorkspaceTab).toBe('authoring')
    expect(result.current.selectedStudentId).toBe('controlled-student')
  })
})
