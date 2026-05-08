'use client'

import { useCallback, useState } from 'react'
import {
  combineScheduleDateTimeToIso,
  DEFAULT_SCHEDULE_TIME,
  getDefaultScheduleDateInSchedulingTimezone,
  isScheduleIsoInFuture,
  parseScheduleIsoToParts,
} from '@/lib/scheduling'
import { isAssignmentLive, isAssignmentScheduledForFuture } from '@/lib/assignments'
import type { Assignment } from '@/types'

export type CreateSubmitAction = 'post' | 'schedule' | 'draft'

interface SplitOption {
  id: string
  label: string
  onSelect: () => void
  disabled?: boolean
}

interface UseAssignmentSchedulingOptions {
  currentAssignment: Assignment | null
  isCreateMode: boolean
  creating: boolean
  saving: boolean
  /** Flush any pending autosave before performing a release operation. */
  flushPendingChanges: () => Promise<void>
  /** Update the component's currentAssignment state after a release operation. */
  onAssignmentChange: (assignment: Assignment) => void
  onSuccess: (assignment: Assignment, options?: { closeModal?: boolean }) => void
  onClose: () => void
  onError: (msg: string) => void
}

export interface UseAssignmentSchedulingReturn {
  scheduleDate: string
  setScheduleDate: React.Dispatch<React.SetStateAction<string>>
  scheduleTime: string
  setScheduleTime: React.Dispatch<React.SetStateAction<string>>
  primaryAction: CreateSubmitAction
  setPrimaryAction: React.Dispatch<React.SetStateAction<CreateSubmitAction>>
  showPostNowConfirm: boolean
  setShowPostNowConfirm: React.Dispatch<React.SetStateAction<boolean>>
  showRevertToDraftConfirm: boolean
  setShowRevertToDraftConfirm: React.Dispatch<React.SetStateAction<boolean>>
  showCreateScheduleModal: boolean
  setShowCreateScheduleModal: React.Dispatch<React.SetStateAction<boolean>>
  releasing: boolean
  /** Derived status flags */
  isDraft: boolean
  isScheduled: boolean
  isLive: boolean
  scheduleIso: string
  isScheduleValid: boolean
  effectivePrimaryAction: CreateSubmitAction
  primaryLabel: string
  splitOptions: SplitOption[]
  /** Reset all scheduling state when the modal opens for a new/existing assignment. */
  resetForAssignment: (assignment?: Assignment | null) => void
  formatReleaseDate: (iso: string) => string
  postAssignmentNow: (options?: { closeAfter?: boolean }) => Promise<void>
  scheduleAssignmentRelease: (options?: { closeAfter?: boolean }) => Promise<void>
  revertAssignmentToDraft: () => Promise<void>
  clearScheduledRelease: () => Promise<void>
  syncScheduleInputsFromAssignment: () => void
  openScheduleModalWithSave: () => Promise<void>
  handleActionSelection: (action: CreateSubmitAction) => void
  triggerPrimaryAction: (action?: CreateSubmitAction) => Promise<void>
}

/**
 * Manages the release/scheduling lifecycle for assignments in AssignmentModal.
 *
 * Extracted from AssignmentModal to isolate the "post / schedule / revert to draft"
 * concern from the autosave concern.
 *
 * @example
 * ```tsx
 * const scheduling = useAssignmentScheduling({
 *   currentAssignment,
 *   isCreateMode,
 *   creating,
 *   saving,
 *   flushPendingChanges,
 *   onAssignmentChange: setCurrentAssignment,
 *   onSuccess,
 *   onClose,
 *   onError: setError,
 * })
 * ```
 */
export function useAssignmentScheduling({
  currentAssignment,
  isCreateMode,
  creating,
  saving,
  flushPendingChanges,
  onAssignmentChange,
  onSuccess,
  onClose,
  onError,
}: UseAssignmentSchedulingOptions): UseAssignmentSchedulingReturn {
  const [scheduleDate, setScheduleDate] = useState(getDefaultScheduleDateInSchedulingTimezone())
  const [scheduleTime, setScheduleTime] = useState(DEFAULT_SCHEDULE_TIME)
  const [primaryAction, setPrimaryAction] = useState<CreateSubmitAction>('post')
  const [showPostNowConfirm, setShowPostNowConfirm] = useState(false)
  const [showRevertToDraftConfirm, setShowRevertToDraftConfirm] = useState(false)
  const [showCreateScheduleModal, setShowCreateScheduleModal] = useState(false)
  const [releasing, setReleasing] = useState(false)

  // Derived status flags
  const isDraft = !currentAssignment || currentAssignment.is_draft
  const isScheduled = !!currentAssignment && isAssignmentScheduledForFuture(currentAssignment)
  const isLive = !!currentAssignment && isAssignmentLive(currentAssignment)
  const scheduleIso = scheduleDate ? combineScheduleDateTimeToIso(scheduleDate, scheduleTime) : ''
  const isScheduleValid = scheduleIso ? isScheduleIsoInFuture(scheduleIso) : false
  const effectivePrimaryAction: CreateSubmitAction = isScheduled ? 'schedule' : primaryAction
  const primaryLabel =
    effectivePrimaryAction === 'post'
      ? releasing
        ? 'Posting...'
        : 'Post'
      : effectivePrimaryAction === 'schedule'
        ? releasing
          ? 'Scheduling...'
          : 'Schedule'
        : saving
          ? 'Saving...'
          : 'Draft'
  const splitOptions: SplitOption[] = isScheduled
    ? []
    : [
        { id: 'post', label: 'Post', onSelect: () => handleActionSelection('post') },
        { id: 'schedule', label: 'Schedule', onSelect: () => handleActionSelection('schedule') },
        { id: 'draft', label: 'Draft', onSelect: () => handleActionSelection('draft'), disabled: isLive },
      ].filter((option) => option.id !== effectivePrimaryAction)

  /** Reset scheduling UI to initial state when the modal opens. */
  const resetForAssignment = useCallback((assignment?: Assignment | null) => {
    setShowPostNowConfirm(false)
    setShowRevertToDraftConfirm(false)
    setShowCreateScheduleModal(false)
    setReleasing(false)

    if (assignment?.released_at && isAssignmentScheduledForFuture(assignment)) {
      const scheduled = parseScheduleIsoToParts(assignment.released_at)
      setScheduleDate(scheduled.date)
      setScheduleTime(scheduled.time)
      setPrimaryAction('schedule')
    } else {
      setScheduleDate(getDefaultScheduleDateInSchedulingTimezone())
      setScheduleDate(getDefaultScheduleDateInSchedulingTimezone())
      setScheduleTime(DEFAULT_SCHEDULE_TIME)
      setPrimaryAction('post')
    }
  }, [])

  function formatReleaseDate(iso: string): string {
    return new Date(iso)
      .toLocaleString('en-US', {
        timeZone: 'America/Toronto',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
      .replace(/^([A-Za-z]{3}),\s/, '$1 ')
  }

  function syncScheduleInputsFromAssignment() {
    if (currentAssignment?.released_at && isAssignmentScheduledForFuture(currentAssignment)) {
      const parsed = parseScheduleIsoToParts(currentAssignment.released_at)
      setScheduleDate(parsed.date)
      setScheduleTime(parsed.time)
    } else {
      setScheduleDate(getDefaultScheduleDateInSchedulingTimezone())
      setScheduleDate(getDefaultScheduleDateInSchedulingTimezone())
      setScheduleTime(DEFAULT_SCHEDULE_TIME)
    }
  }

  const postAssignmentNow = useCallback(
    async (options?: { closeAfter?: boolean }) => {
      if (releasing) return
      const assignmentToRelease = currentAssignment
      if (!assignmentToRelease) return

      onError('')
      setReleasing(true)
      try {
        await flushPendingChanges()

        const response = assignmentToRelease.is_draft
          ? await fetch(`/api/teacher/assignments/${assignmentToRelease.id}/release`, { method: 'POST' })
          : await fetch(`/api/teacher/assignments/${assignmentToRelease.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ released_at: null }),
            })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Failed to post assignment')

        const updated = data.assignment as Assignment
        onAssignmentChange(updated)
        if (!isCreateMode || (options?.closeAfter ?? true)) onSuccess(updated)
        if (options?.closeAfter ?? true) onClose()
      } catch (err: unknown) {
        onError(err instanceof Error ? err.message : 'Failed to post assignment')
      } finally {
        setReleasing(false)
        setShowPostNowConfirm(false)
      }
    },
    [currentAssignment, flushPendingChanges, isCreateMode, onAssignmentChange, onClose, onError, onSuccess, releasing]
  )

  const scheduleAssignmentRelease = useCallback(
    async (options?: { closeAfter?: boolean }) => {
      if (releasing) return
      const assignmentToSchedule = currentAssignment
      if (!assignmentToSchedule || !scheduleDate) return

      const releaseIso = combineScheduleDateTimeToIso(scheduleDate, scheduleTime)
      if (!isScheduleIsoInFuture(releaseIso)) {
        onError('Release time must be in the future')
        return
      }

      onError('')
      setReleasing(true)
      try {
        await flushPendingChanges()

        const response = assignmentToSchedule.is_draft
          ? await fetch(`/api/teacher/assignments/${assignmentToSchedule.id}/release`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ release_at: releaseIso }),
            })
          : await fetch(`/api/teacher/assignments/${assignmentToSchedule.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ released_at: releaseIso }),
            })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Failed to schedule assignment')

        const updated = data.assignment as Assignment
        onAssignmentChange(updated)
        if (!isCreateMode) onSuccess(updated)
        setShowCreateScheduleModal(false)
        setPrimaryAction('schedule')
        if (options?.closeAfter) onClose()
      } catch (err: unknown) {
        onError(err instanceof Error ? err.message : 'Failed to schedule assignment')
      } finally {
        setReleasing(false)
      }
    },
    [
      currentAssignment,
      flushPendingChanges,
      isCreateMode,
      onAssignmentChange,
      onClose,
      onError,
      onSuccess,
      releasing,
      scheduleDate,
      scheduleTime,
    ]
  )

  const revertAssignmentToDraft = useCallback(async () => {
    if (releasing) return
    const assignmentToUpdate = currentAssignment
    if (!assignmentToUpdate || assignmentToUpdate.is_draft) return

    onError('')
    setReleasing(true)
    try {
      await flushPendingChanges()
      const response = await fetch(`/api/teacher/assignments/${assignmentToUpdate.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_draft: true, released_at: null }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to revert assignment to draft')

      const updated = data.assignment as Assignment
      onAssignmentChange(updated)
      onSuccess(updated)
      setPrimaryAction('post')
      setShowRevertToDraftConfirm(false)
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed to revert assignment to draft')
    } finally {
      setReleasing(false)
    }
  }, [currentAssignment, flushPendingChanges, onAssignmentChange, onError, onSuccess, releasing])

  const clearScheduledRelease = useCallback(async () => {
    if (releasing) return
    const assignmentToUpdate = currentAssignment
    if (!assignmentToUpdate || !isScheduled) return

    onError('')
    setReleasing(true)
    try {
      await flushPendingChanges()
      const response = await fetch(`/api/teacher/assignments/${assignmentToUpdate.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_draft: true, released_at: null }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to clear scheduled release')

      const updated = data.assignment as Assignment
      onAssignmentChange(updated)
      if (!isCreateMode) onSuccess(updated, { closeModal: false })
      // Keep modal open after clearing so the user can immediately re-schedule.
      // Unlike revertAssignmentToDraft, primaryAction stays 'schedule' so the user
      // can pick a new time without an extra click.
      setPrimaryAction('schedule')
      setShowCreateScheduleModal(false)
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed to clear scheduled release')
    } finally {
      setReleasing(false)
    }
  }, [currentAssignment, flushPendingChanges, isCreateMode, isScheduled, onAssignmentChange, onError, onSuccess, releasing])

  const openScheduleModalWithSave = useCallback(async () => {
    if (!currentAssignment || saving || releasing || creating) return
    try {
      await flushPendingChanges()
      syncScheduleInputsFromAssignment()
      setShowCreateScheduleModal(true)
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed to save changes')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAssignment, creating, flushPendingChanges, onError, releasing, saving])

  function handleActionSelection(action: CreateSubmitAction) {
    setPrimaryAction(action)
    if (action === 'schedule') {
      void openScheduleModalWithSave()
    }
  }

  const triggerPrimaryAction = useCallback(
    async (action: CreateSubmitAction = primaryAction) => {
      if (!currentAssignment || creating || saving || releasing) return

      if (action === 'post') {
        setShowPostNowConfirm(true)
        return
      }

      if (action === 'schedule') {
        await openScheduleModalWithSave()
        return
      }

      // 'draft' action
      if (!currentAssignment.is_draft) {
        setShowRevertToDraftConfirm(true)
        return
      }

      // Already a draft — handled by the component (saveDraftAndClose)
    },
    [creating, currentAssignment, openScheduleModalWithSave, primaryAction, releasing, saving]
  )

  return {
    scheduleDate,
    setScheduleDate,
    scheduleTime,
    setScheduleTime,
    primaryAction,
    setPrimaryAction,
    showPostNowConfirm,
    setShowPostNowConfirm,
    showRevertToDraftConfirm,
    setShowRevertToDraftConfirm,
    showCreateScheduleModal,
    setShowCreateScheduleModal,
    releasing,
    isDraft,
    isScheduled,
    isLive,
    scheduleIso,
    isScheduleValid,
    effectivePrimaryAction,
    primaryLabel,
    splitOptions,
    resetForAssignment,
    formatReleaseDate,
    postAssignmentNow,
    scheduleAssignmentRelease,
    revertAssignmentToDraft,
    clearScheduledRelease,
    syncScheduleInputsFromAssignment,
    openScheduleModalWithSave,
    handleActionSelection,
    triggerPrimaryAction,
  }
}
