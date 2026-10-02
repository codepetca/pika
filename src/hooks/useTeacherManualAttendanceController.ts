'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAttendanceMarkQueue } from '@/hooks/useAttendanceMarkQueue'
import { fetchJSON } from '@/lib/request-cache'
import {
  DEFAULT_MANUAL_ATTENDANCE_SETTINGS,
  MAX_MANUAL_ATTENDANCE_MARKS_PER_REQUEST,
  type ManualAttendanceMark,
  type ManualAttendanceSettings,
  type ManualAttendanceSourceMode,
  type ManualAttendanceStatus,
  type ManualAttendanceView,
} from '@/lib/manual-attendance'
import { useAppMessage } from '@/ui'

function manualAttendanceUrl(classroomId: string, classDate: string) {
  const params = new URLSearchParams({ classroom_id: classroomId, date: classDate })
  return `/api/teacher/manual-attendance?${params.toString()}`
}

function applyManualAttendanceMarks(
  current: ManualAttendanceView,
  studentIds: string[],
  status: ManualAttendanceMark,
) {
  const nextOverrides = new Map(
    current.overrides.map((override) => [override.studentId, override.status]),
  )
  studentIds.forEach((studentId) => {
    if (status === 'automatic') nextOverrides.delete(studentId)
    else nextOverrides.set(studentId, status)
  })
  return {
    ...current,
    overrides: [...nextOverrides].map(([studentId, nextStatus]) => ({
      studentId,
      status: nextStatus,
    })),
  }
}

function matchesManualAttendanceMark(view: ManualAttendanceView, studentId: string, status: ManualAttendanceMark) {
  const override = view.overrides.find(candidate => candidate.studentId === studentId)
  return status === 'automatic' ? !override : override?.status === status
}

type ManualAttendanceScope = {
  key: string
  classroomId: string
  selectedDate: string
  enabled: boolean
  isActive: boolean
}

export function useTeacherManualAttendanceController(input: {
  classroomId: string
  selectedDate: string
  enabled: boolean
  isActive: boolean
  archived: boolean
  visibleStudentIds: string[]
}) {
  const { showMessage } = useAppMessage()
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [activeCommand, setActiveCommand] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const commandSequence = useRef(0)
  const mountedRef = useRef(true)
  const activeCommandRef = useRef<{ id: number; scopeKey: string } | null>(null)
  const scope: ManualAttendanceScope = {
    key: `${input.classroomId}:${input.selectedDate}:${input.enabled ? 'enabled' : 'disabled'}:${input.isActive ? 'active' : 'inactive'}`,
    classroomId: input.classroomId,
    selectedDate: input.selectedDate,
    enabled: input.enabled,
    isActive: input.isActive,
  }
  const { queue: markQueue, view, pendingStudentIds } = useAttendanceMarkQueue(
    scope.key, applyManualAttendanceMarks, matchesManualAttendanceMark,
  )
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  const loadScope = useCallback(async (
    requestedScope: ManualAttendanceScope,
    background = false,
  ) => {
    if (!requestedScope.enabled || !requestedScope.isActive || !requestedScope.selectedDate) return null
    const request = ++requestSequence.current
    const readVersion = markQueue.version
    if (background) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const next = await fetchJSON<ManualAttendanceView>(
        manualAttendanceUrl(requestedScope.classroomId, requestedScope.selectedDate),
        { errorMessage: 'Manual attendance is temporarily unavailable' },
      )
      if (
        !mountedRef.current
        || request !== requestSequence.current
        || requestedScope.key !== scopeRef.current.key
      ) return null
      markQueue.accept(next, readVersion)
      return next
    } catch (reason) {
      if (
        mountedRef.current
        && request === requestSequence.current
        && requestedScope.key === scopeRef.current.key
      ) {
        setError(reason instanceof Error ? reason.message : 'Manual attendance is temporarily unavailable')
      }
      return null
    } finally {
      if (
        mountedRef.current
        && request === requestSequence.current
        && requestedScope.key === scopeRef.current.key
      ) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [markQueue])

  const loadView = useCallback(async (background = false) => (
    loadScope(scopeRef.current, background)
  ), [loadScope])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestSequence.current += 1
      commandSequence.current += 1
      activeCommandRef.current = null
    }
  }, [])

  useEffect(() => {
    requestSequence.current += 1
    commandSequence.current += 1
    activeCommandRef.current = null
    setError('')
    setActiveCommand(null)
    setLoading(false)
    setRefreshing(false)
    const nextScope = scopeRef.current
    if (nextScope.enabled && nextScope.isActive && nextScope.selectedDate) {
      void loadScope(nextScope)
    }
  }, [input.classroomId, input.enabled, input.isActive, input.selectedDate, loadScope])

  const settings = view?.settings ?? DEFAULT_MANUAL_ATTENDANCE_SETTINGS
  const overridesByStudentId = useMemo(() => new Map(
    (view?.overrides ?? []).map((override) => [override.studentId, override.status]),
  ), [view?.overrides])

  const submitMarks = useCallback(async (
    studentIds: string[],
    status: ManualAttendanceMark,
    options: { successText?: string } = {},
  ) => {
    if (
      !input.enabled || !input.isActive || input.archived || activeCommandRef.current
      || !view || view.classroomId !== input.classroomId || view.classDate !== input.selectedDate
      || studentIds.length === 0
      || studentIds.some(id => !input.visibleStudentIds.includes(id))
    ) return
    const commandScope = scopeRef.current
    let completedChunks = 0
    try {
      await markQueue.run(studentIds, status, async (ids, commit) => {
        for (let offset = 0; offset < ids.length; offset += MAX_MANUAL_ATTENDANCE_MARKS_PER_REQUEST) {
          if (!markQueue.isActive || scopeRef.current.key !== commandScope.key || !mountedRef.current) break
          const chunk = ids.slice(offset, offset + MAX_MANUAL_ATTENDANCE_MARKS_PER_REQUEST)
          await fetchJSON('/api/teacher/manual-attendance', {
            init: {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ classroom_id: commandScope.classroomId,
                date: commandScope.selectedDate, student_ids: chunk, status }),
            },
            errorMessage: 'Manual attendance could not be updated',
          })
          commit(chunk)
          completedChunks++
        }
        return []
      })
      if (mountedRef.current && markQueue.isActive && scopeRef.current.key === commandScope.key) {
        if (!studentIds.some(id => markQueue.pendingStudentIds.has(id))) showMessage({ text: options.successText ?? (status === 'automatic'
          ? 'Manual changes reverted' : 'Attendance updated'), tone: 'success' })
        if (markQueue.pendingStudentIds.size === 0) void loadScope(commandScope, true)
      }
    } catch (reason) {
      if (mountedRef.current && markQueue.isActive && scopeRef.current.key === commandScope.key) {
        if (completedChunks > 0) {
          const refreshed = await loadScope(commandScope, true)
          if (!mountedRef.current || scopeRef.current.key !== commandScope.key) return
          showMessage({ text: refreshed
            ? 'Some attendance changes were saved; the current attendance has been refreshed'
            : 'Some attendance changes were saved; the current attendance could not be refreshed', tone: 'warning' })
        } else {
          showMessage({ text: reason instanceof Error ? reason.message
            : 'Manual attendance could not be updated', tone: 'warning' })
        }
      }
    }
  }, [input, view, markQueue, loadScope, showMessage])

  const saveSettings = useCallback(async (next: {
    sourceMode?: ManualAttendanceSourceMode
    sessionStartsLocal?: string | null
    sessionEndsLocal?: string | null
  }) => {
    if (!input.enabled || input.archived || activeCommandRef.current || markQueue.pendingStudentIds.size > 0) return false
    const commandScope = scopeRef.current
    const proposed: ManualAttendanceSettings = {
      sourceMode: next.sourceMode ?? settings.sourceMode,
      sessionStartsLocal: next.sessionStartsLocal === undefined
        ? settings.sessionStartsLocal
        : next.sessionStartsLocal,
      sessionEndsLocal: next.sessionEndsLocal === undefined
        ? settings.sessionEndsLocal
        : next.sessionEndsLocal,
      revision: settings.revision,
    }
    const commandId = ++commandSequence.current
    activeCommandRef.current = { id: commandId, scopeKey: commandScope.key }
    requestSequence.current += 1
    setActiveCommand('settings')
    try {
      await fetchJSON<{ settings: ManualAttendanceSettings }>(
        '/api/teacher/manual-attendance',
        {
          init: {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              classroom_id: commandScope.classroomId,
              expected_revision: proposed.revision,
              source_mode: proposed.sourceMode,
              session_starts_local: proposed.sessionStartsLocal,
              session_ends_local: proposed.sessionEndsLocal,
            }),
          },
          errorMessage: 'Manual attendance settings could not be saved',
        },
      )
      requestSequence.current += 1
      const currentScope = scopeRef.current
      if (mountedRef.current && currentScope.classroomId === commandScope.classroomId) {
        void loadScope(currentScope, true)
        showMessage({ text: 'Manual attendance settings saved', tone: 'success' })
      }
      return true
    } catch (reason) {
      const currentScope = scopeRef.current
      if (mountedRef.current && currentScope.classroomId === commandScope.classroomId) {
        showMessage({
          text: reason instanceof Error ? reason.message : 'Manual attendance settings could not be saved',
          tone: 'warning',
        })
        void loadScope(currentScope, true)
      }
      return false
    } finally {
      if (activeCommandRef.current?.id === commandId) {
        activeCommandRef.current = null
        if (mountedRef.current && markQueue.isActive && scopeRef.current.key === commandScope.key) {
          setActiveCommand(null)
        }
      }
    }
  }, [input.archived, input.enabled, loadScope, markQueue, settings, showMessage])

  return {
    view,
    settings,
    overridesByStudentId,
    loading,
    refreshing,
    error,
    activeCommand,
    pendingStudentIds,
    canMark: input.enabled && !input.archived && !loading && !error,
    loadView,
    submitMarks,
    saveSettings,
  }
}
