import { useCallback, useState } from 'react'

export type TestWorkspaceState = 'list' | 'selected'
export type TestWorkspaceTab = 'authoring' | 'grading'

export type UpdateSearchOptions = {
  replace?: boolean
}

export type UpdateSearchParamsFn = (
  updater: (params: URLSearchParams) => void,
  options?: UpdateSearchOptions,
) => void

type WorkspaceTarget = {
  testId: string | null
  mode?: TestWorkspaceTab | null
  studentId?: string | null
}

type UseTestWorkspaceNavigationOptions = {
  selectedTestId?: string | null
  selectedTestMode?: TestWorkspaceTab | null
  selectedTestStudentId?: string | null
  updateSearchParams?: UpdateSearchParamsFn
}

export function useTestWorkspaceNavigation({
  selectedTestId: selectedTestIdProp,
  selectedTestMode,
  selectedTestStudentId,
  updateSearchParams,
}: UseTestWorkspaceNavigationOptions) {
  const [internalSelectedWorkspaceTab, setInternalSelectedWorkspaceTab] =
    useState<TestWorkspaceTab>('grading')
  const [internalSelectedTestId, setInternalSelectedTestId] = useState<string | null>(null)
  const [internalSelectedStudentId, setInternalSelectedStudentId] = useState<string | null>(null)

  const selectedTestId =
    selectedTestIdProp !== undefined ? selectedTestIdProp : internalSelectedTestId
  const selectedWorkspaceTab =
    selectedTestMode === 'authoring' || selectedTestMode === 'grading'
      ? selectedTestMode
      : internalSelectedWorkspaceTab
  const selectedStudentId =
    selectedTestStudentId !== undefined ? selectedTestStudentId : internalSelectedStudentId
  const workspaceState: TestWorkspaceState = selectedTestId ? 'selected' : 'list'

  const navigateTestWorkspace = useCallback((
    next: WorkspaceTarget,
    options?: UpdateSearchOptions,
  ) => {
    const nextMode = next.testId ? (next.mode ?? 'grading') : null
    setInternalSelectedTestId(next.testId)
    setInternalSelectedWorkspaceTab(nextMode ?? 'grading')
    setInternalSelectedStudentId(next.studentId ?? null)

    updateSearchParams?.((params) => {
      params.set('tab', 'tests')
      if (next.testId) {
        params.set('testId', next.testId)
        params.set('testMode', nextMode ?? 'grading')
        if (nextMode === 'grading' && next.studentId) {
          params.set('testStudentId', next.studentId)
        } else {
          params.delete('testStudentId')
        }
      } else {
        params.delete('testId')
        params.delete('testMode')
        params.delete('testStudentId')
      }
    }, options)
  }, [updateSearchParams])

  const clearTestWorkspace = useCallback((options?: UpdateSearchOptions) => {
    navigateTestWorkspace({ testId: null, mode: null, studentId: null }, options)
  }, [navigateTestWorkspace])

  return {
    selectedTestId,
    selectedWorkspaceTab,
    selectedStudentId,
    workspaceState,
    setSelectedStudentId: setInternalSelectedStudentId,
    navigateTestWorkspace,
    clearTestWorkspace,
  }
}
