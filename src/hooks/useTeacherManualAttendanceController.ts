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

  const loadView = useCallback(async (background = false) => {
    if (!input.enabled || !input.isActive || !input.selectedDate) return null
    const request = ++requestSequence.current
    if (background) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const next = await fetchJSON<ManualAttendanceView>(
        manualAttendanceUrl(input.classroomId, input.selectedDate),
        { errorMessage: 'Manual attendance is temporarily unavailable' },
      )
      if (request !== requestSequence.current) return null
      setView(next)
      return next
    } catch (reason) {
      if (request === requestSequence.current) {
        setError(reason instanceof Error ? reason.message : 'Manual attendance is temporarily unavailable')
      }
      return null
    } finally {
      if (request === requestSequence.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [input.classroomId, input.enabled, input.isActive, input.selectedDate])

  useEffect(() => {
    requestSequence.current += 1
    setView(null)
    setError('')
    if (input.enabled && input.isActive && input.selectedDate) void loadView()
  }, [input.classroomId, input.enabled, input.isActive, input.selectedDate, loadView])

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
      || activeCommand
      || studentIds.length === 0
      || studentIds.some((studentId) => !input.visibleStudentIds.includes(studentId))
    ) return
    setActiveCommand('marks')
    try {
      await fetchJSON('/api/teacher/manual-attendance', {
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroom_id: input.classroomId,
            date: input.selectedDate,
            student_ids: studentIds,
            status,
          }),
        },
        errorMessage: 'Manual attendance could not be updated',
      })
      const nextOverrides = new Map(overridesByStudentId)
      studentIds.forEach((studentId) => {
        if (status === 'automatic') nextOverrides.delete(studentId)
        else nextOverrides.set(studentId, status)
      })
      setView((current) => ({
        classroomId: input.classroomId,
        classDate: input.selectedDate,
        settings: current?.settings ?? settings,
        overrides: [...nextOverrides].map(([studentId, nextStatus]) => ({ studentId, status: nextStatus })),
      }))
      showMessage({
        text: options.successText ?? (status === 'automatic' ? 'Manual changes reverted' : 'Attendance updated'),
        tone: 'success',
      })
    } catch (reason) {
      showMessage({
        text: reason instanceof Error ? reason.message : 'Manual attendance could not be updated',
        tone: 'warning',
      })
    } finally {
      setActiveCommand(null)
    }
  }, [
    activeCommand,
    input.archived,
    input.classroomId,
    input.enabled,
    input.selectedDate,
    input.visibleStudentIds,
    overridesByStudentId,
    settings,
    showMessage,
  ])

  const saveSettings = useCallback(async (next: {
    sourceMode?: ManualAttendanceSourceMode
    sessionStartsLocal?: string | null
    sessionEndsLocal?: string | null
  }) => {
    if (!input.enabled || input.archived || activeCommand) return false
    const proposed: ManualAttendanceSettings = {
      sourceMode: next.sourceMode ?? settings.sourceMode,
      sessionStartsLocal: next.sessionStartsLocal === undefined
        ? settings.sessionStartsLocal
        : next.sessionStartsLocal,
      sessionEndsLocal: next.sessionEndsLocal === undefined
        ? settings.sessionEndsLocal
        : next.sessionEndsLocal,
    }
    setActiveCommand('settings')
    try {
      const response = await fetchJSON<{ settings: ManualAttendanceSettings }>(
        '/api/teacher/manual-attendance',
        {
          init: {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              classroom_id: input.classroomId,
              source_mode: proposed.sourceMode,
              session_starts_local: proposed.sessionStartsLocal,
              session_ends_local: proposed.sessionEndsLocal,
            }),
          },
          errorMessage: 'Manual attendance settings could not be saved',
        },
      )
      setView((current) => ({
        classroomId: input.classroomId,
        classDate: input.selectedDate,
        settings: response.settings,
        overrides: current?.overrides ?? [],
      }))
      showMessage({ text: 'Manual attendance settings saved', tone: 'success' })
      return true
    } catch (reason) {
      showMessage({
        text: reason instanceof Error ? reason.message : 'Manual attendance settings could not be saved',
        tone: 'warning',
      })
      return false
    } finally {
      setActiveCommand(null)
    }
  }, [activeCommand, input.archived, input.classroomId, input.enabled, input.selectedDate, settings, showMessage])

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
