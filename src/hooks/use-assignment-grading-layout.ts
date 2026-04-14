'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { readCookie, writeCookie } from '@/lib/cookies'
import {
  clampAssignmentGradingLayout,
  getAssignmentGradingLayoutCookieName,
  getDefaultAssignmentGradingLayout,
  parseAssignmentGradingLayout,
  serializeAssignmentGradingLayout,
  type AssignmentGradingLayoutState,
  type AssignmentWorkspaceMode,
  type AssignmentWorkspacePaneLayout,
} from '@/lib/assignment-grading-layout'

export function useAssignmentGradingLayout(
  classroomId: string,
  totalWidth: number,
) {
  const [layout, setLayoutState] = useState<AssignmentGradingLayoutState>(
    getDefaultAssignmentGradingLayout(),
  )
  const [hasHydratedCookie, setHasHydratedCookie] = useState(false)
  const cookieName = getAssignmentGradingLayoutCookieName(classroomId)

  useEffect(() => {
    setLayoutState(parseAssignmentGradingLayout(readCookie(cookieName)))
    setHasHydratedCookie(true)
  }, [cookieName])

  const clampedLayout = useMemo(
    () => clampAssignmentGradingLayout(layout, { totalWidth }),
    [layout, totalWidth],
  )

  useEffect(() => {
    if (!hasHydratedCookie) return
    writeCookie(cookieName, serializeAssignmentGradingLayout(clampedLayout))
  }, [clampedLayout, cookieName, hasHydratedCookie])

  const setLayout = useCallback(
    (
      next:
        | AssignmentGradingLayoutState
        | ((current: AssignmentGradingLayoutState) => AssignmentGradingLayoutState),
    ) => {
      setLayoutState((current) => {
        const candidate = typeof next === 'function' ? next(current) : next
        return clampAssignmentGradingLayout(candidate, { totalWidth })
      })
    },
    [totalWidth],
  )

  const updateModeLayout = useCallback(
    (
      mode: AssignmentWorkspaceMode,
      next:
        | AssignmentWorkspacePaneLayout
        | ((current: AssignmentWorkspacePaneLayout) => AssignmentWorkspacePaneLayout),
    ) => {
      setLayout((current) => ({
        ...current,
        [mode]: typeof next === 'function' ? next(current[mode]) : next,
      }))
    },
    [setLayout],
  )

  const resetLayout = useCallback(() => {
    setLayoutState(getDefaultAssignmentGradingLayout())
  }, [])

  return {
    layout: clampedLayout,
    setLayout,
    updateModeLayout,
    resetLayout,
  }
}
