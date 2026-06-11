'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2, Plus, Clock, Calendar, Settings } from 'lucide-react'
import { Button, ConfirmDialog, SplitButton } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { AnnouncementContent } from '@/components/AnnouncementContent'
import { ClassworkContentModalShell } from '@/components/classwork/ClassworkContentModal'
import { CreationModalTopRow } from '@/components/creation/CreationModalShell'
import { ScheduleDateTimePicker } from '@/components/ScheduleDateTimePicker'
import { TeacherWorkSurfaceActionBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionBar'
import {
  TeacherWorkSurfaceActionCluster,
  TeacherWorkSurfaceIconMenuButton,
  type TeacherWorkSurfaceActionItem,
} from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import type { Announcement, Classroom } from '@/types'
import { fetchCachedJSON, invalidateCachedJSON } from '@/lib/request-cache'
import { cn } from '@/ui/utils'
import {
  ANNOUNCEMENT_TITLE_MAX_LENGTH,
  normalizeAnnouncementTitle,
  sortAnnouncementsNewestFirst,
} from '@/lib/announcements'
import {
  combineScheduleDateTimeToIso,
  DEFAULT_SCHEDULE_TIME,
  getTodayInSchedulingTimezone,
  isScheduleIsoInFuture,
  parseScheduleIsoToParts,
} from '@/lib/scheduling'

interface Props {
  classroom: Classroom
  className?: string
}

type AnnouncementsResponse = { announcements?: Announcement[] }

const ANNOUNCEMENT_TEXTAREA_MIN_HEIGHT_PX = 160

function autoResizeAnnouncementTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return
  textarea.style.height = `${ANNOUNCEMENT_TEXTAREA_MIN_HEIGHT_PX}px`
  const measuredHeight = textarea.scrollHeight
  const nextHeight = measuredHeight > ANNOUNCEMENT_TEXTAREA_MIN_HEIGHT_PX
    ? measuredHeight
    : ANNOUNCEMENT_TEXTAREA_MIN_HEIGHT_PX
  textarea.style.height = `${nextHeight}px`
}

// Helper to check if announcement is scheduled (not yet published)
function isScheduled(announcement: Announcement): boolean {
  if (!announcement.scheduled_for) return false
  return new Date(announcement.scheduled_for) > new Date()
}

// Helper to get today's date in YYYY-MM-DD format
function getTodayDate(): string {
  return getTodayInSchedulingTimezone()
}

// Helper to combine date and optional time into Date object
function combineDateTimeToDate(date: string, time?: string): Date {
  return new Date(combineScheduleDateTimeToIso(date, time))
}

// Helper to combine date and optional time into ISO string
function combineDateTime(date: string, time?: string): string {
  return combineScheduleDateTimeToIso(date, time)
}

// Helper to check if date/time is in the future
function isScheduleInFuture(date: string, time?: string): boolean {
  return isScheduleIsoInFuture(combineDateTime(date, time))
}

// Helper to parse ISO datetime into date and time parts
function parseDateTime(isoString: string): { date: string; time: string } {
  return parseScheduleIsoToParts(isoString)
}

export function TeacherAnnouncementsSection({ classroom, className }: Props) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loadedClassroomId, setLoadedClassroomId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [originalTitle, setOriginalTitle] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [editScheduleDateTime, setEditScheduleDateTime] = useState('')
  const [originalScheduledFor, setOriginalScheduledFor] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [scheduleDateTime, setScheduleDateTime] = useState('')
  const [pendingScheduleDate, setPendingScheduleDate] = useState('')
  const [pendingScheduleTime, setPendingScheduleTime] = useState('')
  const [pendingEditScheduleDate, setPendingEditScheduleDate] = useState('')
  const [pendingEditScheduleTime, setPendingEditScheduleTime] = useState('')
  const [showScheduleDropdown, setShowScheduleDropdown] = useState(false)
  const [showEditScheduleDropdown, setShowEditScheduleDropdown] = useState(false)
  const [showAnnouncementPreview, setShowAnnouncementPreview] = useState(false)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)
  const newTextareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const editDropdownRef = useRef<HTMLDivElement>(null)
  const loadRequestIdRef = useRef(0)

  const isReadOnly = !!classroom.archived_at

  const loadAnnouncements = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    setLoading(true)
    try {
      const data = await fetchCachedJSON<AnnouncementsResponse>(
        `teacher-announcements:${classroom.id}`,
        `/api/teacher/classrooms/${classroom.id}/announcements`,
        { ttlMs: 20_000, errorMessage: 'Failed to load announcements' },
      )
      if (loadRequestIdRef.current !== requestId) return
      setAnnouncements(data.announcements || [])
      setLoadedClassroomId(classroom.id)
    } catch (err) {
      if (loadRequestIdRef.current !== requestId) return
      setAnnouncements([])
      setLoadedClassroomId(classroom.id)
      console.error('Error loading announcements:', err)
    } finally {
      if (loadRequestIdRef.current === requestId) {
        setLoading(false)
      }
    }
  }, [classroom.id])

  useEffect(() => {
    loadAnnouncements()
  }, [loadAnnouncements])

  // Focus textarea when editing starts
  useEffect(() => {
    if (editingId && editTextareaRef.current) {
      editTextareaRef.current.focus()
      editTextareaRef.current.setSelectionRange(
        editTextareaRef.current.value.length,
        editTextareaRef.current.value.length
      )
    }
  }, [editingId])

  useEffect(() => {
    if (!editingId) return
    autoResizeAnnouncementTextarea(editTextareaRef.current)
  }, [editingId, editContent])

  // Focus textarea when creating
  useEffect(() => {
    if (isCreating && newTextareaRef.current) {
      newTextareaRef.current.focus()
    }
  }, [isCreating])

  useEffect(() => {
    if (!isCreating) return
    autoResizeAnnouncementTextarea(newTextareaRef.current)
  }, [isCreating, newContent])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowScheduleDropdown(false)
      }
    }
    if (showScheduleDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showScheduleDropdown])

  // Close edit dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (editDropdownRef.current && !editDropdownRef.current.contains(event.target as Node)) {
        setShowEditScheduleDropdown(false)
      }
    }
    if (showEditScheduleDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showEditScheduleDropdown])

  function startEditing(announcement: Announcement) {
    if (isReadOnly || saving) return
    setEditingId(announcement.id)
    setEditTitle(announcement.title ?? '')
    setOriginalTitle(announcement.title ?? null)
    setEditContent(announcement.content)
    setOriginalContent(announcement.content)
    // Convert ISO to local datetime-local format if scheduled
    if (announcement.scheduled_for) {
      setEditScheduleDateTime(announcement.scheduled_for)
      setOriginalScheduledFor(announcement.scheduled_for)
    } else {
      setEditScheduleDateTime('')
      setOriginalScheduledFor(null)
    }
  }

  function cancelEditing() {
    setEditingId(null)
    setEditTitle('')
    setOriginalTitle(null)
    setEditContent('')
    setOriginalContent('')
    setEditScheduleDateTime('')
    setOriginalScheduledFor(null)
    setShowEditScheduleDropdown(false)
    setShowAnnouncementPreview(false)
  }

  async function saveEdit() {
    if (!editingId || !editContent.trim() || saving) return

    // Check if anything changed
    const normalizedEditTitle = normalizeAnnouncementTitle(editTitle)
    const contentChanged = editContent.trim() !== originalContent.trim()
    const titleChanged = normalizedEditTitle !== normalizeAnnouncementTitle(originalTitle)
    const newScheduledFor = editScheduleDateTime ? new Date(editScheduleDateTime).toISOString() : null
    const scheduleChanged = newScheduledFor !== originalScheduledFor

    // Don't save if nothing changed
    if (!contentChanged && !titleChanged && !scheduleChanged) {
      cancelEditing()
      return
    }

    setSaving(true)
    const prevAnnouncements = announcements
    const optimisticScheduledFor = editScheduleDateTime ? new Date(editScheduleDateTime).toISOString() : null
    setAnnouncements((prev) =>
      prev.map((a) =>
        a.id === editingId
          ? {
              ...a,
              title: normalizedEditTitle,
              content: editContent.trim(),
              scheduled_for: optimisticScheduledFor,
              updated_at: new Date().toISOString(),
            }
          : a,
      ),
    )
    try {
      const body: { content?: string; scheduled_for?: string | null; title?: string | null } = {}
      if (titleChanged) {
        body.title = normalizedEditTitle
      }
      if (contentChanged) {
        body.content = editContent.trim()
      }
      if (scheduleChanged) {
        body.scheduled_for = newScheduledFor
      }

      const res = await fetch(
        `/api/teacher/classrooms/${classroom.id}/announcements/${editingId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )
      if (!res.ok) throw new Error('Failed to update')
      const data = await res.json()
      setAnnouncements((prev) =>
        prev.map((a) => (a.id === data.announcement.id ? data.announcement : a))
      )
      invalidateCachedJSON(`teacher-announcements:${classroom.id}`)
      invalidateCachedJSON(`student-announcements:${classroom.id}`)
      cancelEditing()
    } catch (err) {
      setAnnouncements(prevAnnouncements)
      console.error('Error updating announcement:', err)
    } finally {
      setSaving(false)
    }
  }

  async function createAnnouncement(scheduledFor?: string) {
    if (!newContent.trim() || saving) return

    setSaving(true)
    const normalizedNewTitle = normalizeAnnouncementTitle(newTitle)
    const tempId = `temp-${Date.now()}`
    const now = new Date().toISOString()
    const optimisticAnnouncement: Announcement = {
      id: tempId,
      classroom_id: classroom.id,
      title: normalizedNewTitle,
      content: newContent.trim(),
      created_by: classroom.teacher_id,
      scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
      created_at: now,
      updated_at: now,
    }
    setAnnouncements((prev) => [optimisticAnnouncement, ...prev])
    try {
      const body: { content: string; scheduled_for?: string; title?: string } = { content: newContent.trim() }
      if (normalizedNewTitle) {
        body.title = normalizedNewTitle
      }
      if (scheduledFor) {
        body.scheduled_for = new Date(scheduledFor).toISOString()
      }

      const res = await fetch(`/api/teacher/classrooms/${classroom.id}/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed to create')
      const data = await res.json()
      setAnnouncements((prev) =>
        prev.map((a) => (a.id === tempId ? data.announcement : a))
      )
      invalidateCachedJSON(`teacher-announcements:${classroom.id}`)
      invalidateCachedJSON(`student-announcements:${classroom.id}`)
      setIsCreating(false)
      setNewTitle('')
      setNewContent('')
      setScheduleDateTime('')
      setShowScheduleDropdown(false)
    } catch (err) {
      setAnnouncements((prev) => prev.filter((a) => a.id !== tempId))
      console.error('Error creating announcement:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return

    setDeleting(true)
    const target = deleteTarget
    const prevAnnouncements = announcements
    setAnnouncements((prev) => prev.filter((a) => a.id !== target.id))
    try {
      const res = await fetch(
        `/api/teacher/classrooms/${classroom.id}/announcements/${target.id}`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error('Failed to delete')
      invalidateCachedJSON(`teacher-announcements:${classroom.id}`)
      invalidateCachedJSON(`student-announcements:${classroom.id}`)
      setDeleteTarget(null)
    } catch (err) {
      setAnnouncements(prevAnnouncements)
      console.error('Delete error:', err)
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString)
    const weekday = date.toLocaleDateString('en-US', { weekday: 'short' })
    const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return `${weekday} ${monthDay}, ${time}`
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      cancelEditing()
    }
  }

  function handleNewKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      setIsCreating(false)
      setNewTitle('')
      setNewContent('')
      setShowAnnouncementPreview(false)
    }
  }

  function openCreateSchedulePicker() {
    setPendingScheduleDate(getTodayDate())
    setPendingScheduleTime(DEFAULT_SCHEDULE_TIME)
    setShowScheduleDropdown(true)
  }

  function openEditSchedulePicker() {
    setPendingEditScheduleDate(getTodayDate())
    setPendingEditScheduleTime(DEFAULT_SCHEDULE_TIME)
    setShowEditScheduleDropdown(true)
  }

  const currentAnnouncements = loadedClassroomId === classroom.id ? announcements : []
  const isLoading = loading || loadedClassroomId !== classroom.id
  const announcementActionItems: TeacherWorkSurfaceActionItem[] = [
    {
      id: 'announcement',
      label: 'Announcement',
      onSelect: () => setIsCreating(true),
    },
  ]
  const editingAnnouncement = editingId
    ? currentAnnouncements.find((announcement) => announcement.id === editingId) ?? null
    : null
  const announcementModalOpen = isCreating || !!editingAnnouncement
  const modalTitle = editingAnnouncement ? 'Edit Announcement' : 'New Announcement'
  const modalBody = editingAnnouncement ? editContent : newContent
  const modalTitleValue = editingAnnouncement ? editTitle : newTitle
  const modalScheduledFor = editingAnnouncement ? editScheduleDateTime : scheduleDateTime

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', className ?? 'max-w-2xl mx-auto')}>
      {!isReadOnly && (
        <TeacherWorkSurfaceActionBar
          testId="announcements-actionbar-center"
          center={
            <TeacherWorkSurfaceActionCluster>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setIsCreating(true)}
                disabled={isCreating || saving}
                aria-label="New announcement"
              >
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>New</span>
                </span>
              </Button>
              <TeacherWorkSurfaceIconMenuButton
                ariaLabel="Announcement actions"
                tooltip="Announcement actions"
                icon={<Settings className="h-4 w-4" aria-hidden="true" />}
                items={announcementActionItems}
                disabled={isCreating || saving}
                menuPlacement="down"
                menuAlign="center"
                menuClassName="w-64"
              />
            </TeacherWorkSurfaceActionCluster>
          }
          centerPlacement="floating"
        />
      )}

      {isReadOnly && (
        <div className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
          This classroom is archived. Announcements are read-only.
        </div>
      )}

      {/* Empty state */}
      {currentAnnouncements.length === 0 && !isCreating && (
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <p className="text-sm text-text-muted">
            No announcements yet. Create one to share updates with your students.
          </p>
        </div>
      )}

      {/* Announcements list */}
      {currentAnnouncements.length > 0 && (() => {
        const sortedAnnouncements = sortAnnouncementsNewestFirst(currentAnnouncements)
        const displayedAnnouncements = showAll ? sortedAnnouncements : sortedAnnouncements.slice(0, 5)

        return (
        <div className="space-y-3">
          {displayedAnnouncements.map((announcement) => {
            const scheduled = isScheduled(announcement)
            const title = normalizeAnnouncementTitle(announcement.title)

            return (
              <div
                key={announcement.id}
                className={`bg-surface rounded-lg border p-4 ${
                  scheduled ? 'border-amber-500/50 bg-amber-500/5' : 'border-border'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                    <div
                      className={`min-w-0 flex-1 ${!isReadOnly ? 'cursor-pointer' : ''}`}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('a')) return
                        startEditing(announcement)
                      }}
                    >
                      {scheduled ? (
                        <div className="flex items-center gap-2 mb-2">
                          <Clock className="h-3.5 w-3.5 text-amber-600" />
                          <span className="text-xs font-medium text-amber-600">
                            Scheduled for {formatDate(announcement.scheduled_for!)}
                          </span>
                        </div>
                      ) : (
                        <p className="text-xs text-text-muted mb-2">
                          {formatDate(announcement.created_at)}
                          {announcement.updated_at !== announcement.created_at && ' (edited)'}
                        </p>
                      )}
                      {title && (
                        <h3 className="mb-2 truncate text-sm font-semibold text-text-default">
                          {title}
                        </h3>
                      )}
                      <AnnouncementContent
                        content={announcement.content}
                        tone={scheduled ? 'muted' : 'default'}
                      />
                    </div>
                    {!isReadOnly && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(announcement)}
                        aria-label="Delete announcement"
                        className="flex-shrink-0"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                </div>
              </div>
            )
          })}

          {!showAll && sortedAnnouncements.length > 5 && (
            <Button
              variant="secondary"
              onClick={() => setShowAll(true)}
              className="w-full"
            >
              Show {sortedAnnouncements.length - 5} older announcement{sortedAnnouncements.length - 5 === 1 ? '' : 's'}
            </Button>
          )}
        </div>
        )
      })()}

      <ClassworkContentModalShell
        isOpen={announcementModalOpen}
        onClose={() => {
          if (saving) return
          if (editingAnnouncement) {
            cancelEditing()
          } else {
            setIsCreating(false)
            setNewTitle('')
            setNewContent('')
            setScheduleDateTime('')
            setShowScheduleDropdown(false)
            setShowAnnouncementPreview(false)
          }
        }}
        title={modalTitle}
        titleId="announcement-modal-title"
        closeLabel="Close announcement modal"
        closeDisabled={saving}
        maxWidth="!max-w-3xl"
      >
        <div className="space-y-4">
          <CreationModalTopRow
            title={modalTitleValue}
            titlePlaceholder="Title (optional)"
            titleRequired={false}
            titleDisabled={saving}
            titleMaxLength={ANNOUNCEMENT_TITLE_MAX_LENGTH}
            titleInputClassName="max-w-full"
            titleFieldClassName="max-w-full"
            onTitleChange={editingAnnouncement ? setEditTitle : setNewTitle}
            actions={(
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowAnnouncementPreview((current) => !current)}
                disabled={saving || !modalBody.trim()}
              >
                {showAnnouncementPreview ? 'Edit' : 'Preview'}
              </Button>
            )}
          />

          {showAnnouncementPreview ? (
            <div className="min-h-[10rem] rounded-lg border border-border bg-surface-2 p-3">
              <AnnouncementContent content={modalBody} />
            </div>
          ) : (
            <textarea
              ref={editingAnnouncement ? editTextareaRef : newTextareaRef}
              aria-label={editingAnnouncement ? 'Edit announcement body' : 'Announcement body'}
              value={modalBody}
              onChange={(event) => {
                if (editingAnnouncement) {
                  setEditContent(event.target.value)
                } else {
                  setNewContent(event.target.value)
                }
              }}
              onKeyDown={editingAnnouncement ? handleEditKeyDown : handleNewKeyDown}
              disabled={saving}
              rows={8}
              className="max-h-[50vh] min-h-[12rem] w-full resize-y overflow-y-auto rounded-md border border-border bg-surface-2 px-3 py-2 text-sm leading-6 text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              placeholder="Write an announcement..."
            />
          )}

          {modalScheduledFor && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const { date, time } = parseDateTime(modalScheduledFor)
                  if (editingAnnouncement) {
                    setPendingEditScheduleDate(date)
                    setPendingEditScheduleTime(time)
                    setShowEditScheduleDropdown(true)
                  } else {
                    setPendingScheduleDate(date)
                    setPendingScheduleTime(time)
                    setShowScheduleDropdown(true)
                  }
                }}
                className="flex items-center gap-2 text-sm text-warning hover:text-warning"
              >
                <Calendar className="h-4 w-4 flex-shrink-0" />
                <span>{formatDate(modalScheduledFor)}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (editingAnnouncement) {
                    setEditScheduleDateTime('')
                  } else {
                    setScheduleDateTime('')
                  }
                }}
                disabled={saving}
                className="text-xs text-text-muted hover:text-text-default"
              >
                Clear
              </button>
            </div>
          )}

          <div className="flex items-start justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (editingAnnouncement) {
                  cancelEditing()
                } else {
                  setIsCreating(false)
                  setNewTitle('')
                  setNewContent('')
                  setScheduleDateTime('')
                  setShowScheduleDropdown(false)
                  setShowAnnouncementPreview(false)
                }
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <div className="relative flex items-center" ref={editingAnnouncement ? editDropdownRef : dropdownRef}>
              {modalScheduledFor ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    if (editingAnnouncement) {
                      void saveEdit()
                    } else {
                      void createAnnouncement(scheduleDateTime)
                    }
                  }}
                  disabled={saving || !modalBody.trim()}
                >
                  {saving ? 'Saving...' : editingAnnouncement ? 'Save' : 'Schedule'}
                </Button>
              ) : (
                <SplitButton
                  label={saving ? 'Saving...' : editingAnnouncement ? 'Save' : 'Post'}
                  onPrimaryClick={() => {
                    if (editingAnnouncement) {
                      void saveEdit()
                    } else {
                      void createAnnouncement()
                    }
                  }}
                  disabled={saving || !modalBody.trim()}
                  options={[
                    {
                      id: 'schedule',
                      label: 'Schedule...',
                      onSelect: editingAnnouncement ? openEditSchedulePicker : openCreateSchedulePicker,
                    },
                  ]}
                  toggleAriaLabel="Choose announcement action"
                />
              )}

              {(editingAnnouncement ? showEditScheduleDropdown : showScheduleDropdown) && (
                <ScheduleDateTimePicker
                  className="absolute right-0 top-full z-10 mt-1 min-w-[220px]"
                  date={editingAnnouncement ? pendingEditScheduleDate : pendingScheduleDate}
                  time={editingAnnouncement ? pendingEditScheduleTime : pendingScheduleTime}
                  minDate={getTodayDate()}
                  isFutureValid={
                    editingAnnouncement
                      ? !!pendingEditScheduleDate && isScheduleInFuture(pendingEditScheduleDate, pendingEditScheduleTime)
                      : !!pendingScheduleDate && isScheduleInFuture(pendingScheduleDate, pendingScheduleTime)
                  }
                  onDateChange={editingAnnouncement ? setPendingEditScheduleDate : setPendingScheduleDate}
                  onTimeChange={editingAnnouncement ? setPendingEditScheduleTime : setPendingScheduleTime}
                  onCancel={() => {
                    if (editingAnnouncement) {
                      setShowEditScheduleDropdown(false)
                    } else {
                      setShowScheduleDropdown(false)
                    }
                  }}
                  onConfirm={() => {
                    if (editingAnnouncement) {
                      if (pendingEditScheduleDate && isScheduleInFuture(pendingEditScheduleDate, pendingEditScheduleTime)) {
                        setEditScheduleDateTime(combineDateTime(pendingEditScheduleDate, pendingEditScheduleTime))
                        setShowEditScheduleDropdown(false)
                      }
                    } else if (pendingScheduleDate && isScheduleInFuture(pendingScheduleDate, pendingScheduleTime)) {
                      setScheduleDateTime(combineDateTime(pendingScheduleDate, pendingScheduleTime))
                      setShowScheduleDropdown(false)
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </ClassworkContentModalShell>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete announcement?"
        description="This will permanently remove the announcement. Students will no longer be able to see it."
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        cancelLabel="Cancel"
        confirmVariant="danger"
        isConfirmDisabled={deleting}
        isCancelDisabled={deleting}
        onCancel={() => !deleting && setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}
