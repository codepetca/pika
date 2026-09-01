'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchJSON } from '@/lib/request-cache'
import {
  DEFAULT_MANUAL_ATTENDANCE_SETTINGS,
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
  const [view, setView] = useState<ManualAttendanceView | null>(null)
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
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  const loadScope = useCallback(async (
    requestedScope: ManualAttendanceScope,
    background = false,
  ) => {
    if (!requestedScope.enabled || !requestedScope.isActive || !requestedScope.selectedDate) return null
    const request = ++requestSequence.current
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
      setView(next)
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
  }, [])

  const loadView = useCallback(async (background = false) => (
    loadScope(scopeRef.current, background)
  ), [loadScope])

  useEffect(() => () => {
    mountedRef.current = false
    requestSequence.current += 1
    commandSequence.current += 1
    activeCommandRef.current = null
  }, [])

  useEffect(() => {
    requestSequence.current += 1
    commandSequence.current += 1
    activeCommandRef.current = null
    setView(null)
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
      !input.enabled
      || input.archived
      || activeCommandRef.current
      || studentIds.length === 0
      || studentIds.some((studentId) => !input.visibleStudentIds.includes(studentId))
    ) return
    const commandScope = scopeRef.current
    const commandId = ++commandSequence.current
    activeCommandRef.current = { id: commandId, scopeKey: commandScope.key }
    requestSequence.current += 1
    setActiveCommand('marks')
    try {
      await fetchJSON('/api/teacher/manual-attendance', {
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroom_id: commandScope.classroomId,
            date: commandScope.selectedDate,
            student_ids: studentIds,
            status,
          }),
        },
        errorMessage: 'Manual attendance could not be updated',
      })
      if (
        mountedRef.current
        && activeCommandRef.current?.id === commandId
        && scopeRef.current.key === commandScope.key
      ) {
        setView((current) => {
          if (
            !current
            || current.classroomId !== commandScope.classroomId
            || current.classDate !== commandScope.selectedDate
          ) return current
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
        })
        showMessage({
          text: options.successText ?? (status === 'automatic' ? 'Manual changes reverted' : 'Attendance updated'),
          tone: 'success',
        })
      }
    } catch (reason) {
      if (mountedRef.current && scopeRef.current.key === commandScope.key) {
        showMessage({
          text: reason instanceof Error ? reason.message : 'Manual attendance could not be updated',
          tone: 'warning',
        })
      }
    } finally {
      if (activeCommandRef.current?.id === commandId) {
        activeCommandRef.current = null
        if (mountedRef.current && scopeRef.current.key === commandScope.key) {
          setActiveCommand(null)
        }
      }
    }
  }, [
    input.archived,
    input.enabled,
    input.visibleStudentIds,
    showMessage,
  ])

  const saveSettings = useCallback(async (next: {
    sourceMode?: ManualAttendanceSourceMode
    sessionStartsLocal?: string | null
    sessionEndsLocal?: string | null
  }) => {
    if (!input.enabled || input.archived || activeCommandRef.current) return false
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
        if (mountedRef.current && scopeRef.current.key === commandScope.key) {
          setActiveCommand(null)
        }
      }
    }
  }, [input.archived, input.enabled, loadScope, settings, showMessage])

  return {
    view,
    settings,
    overridesByStudentId,
    loading,
    refreshing,
    error,
    activeCommand,
    canMark: input.enabled && !input.archived && !loading && !error,
    loadView,
    submitMarks,
    saveSettings,
  }
}
