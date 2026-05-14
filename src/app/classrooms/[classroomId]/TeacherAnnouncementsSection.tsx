'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { Trash2, Plus, Clock, Calendar } from 'lucide-react'
import { Button, ConfirmDialog, FormField, Input, SplitButton } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { AnnouncementContent } from '@/components/AnnouncementContent'
import { ScheduleDateTimePicker } from '@/components/ScheduleDateTimePicker'
import { TeacherWorkSurfaceActionBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionBar'
import type { Announcement, Classroom } from '@/types'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'
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
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)
  const newTextareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const editDropdownRef = useRef<HTMLDivElement>(null)

  const isReadOnly = !!classroom.archived_at

  const loadAnnouncements = useCallback(async () => {
    try {
      const data = await fetchJSONWithCache(
        `teacher-announcements:${classroom.id}`,
        async () => {
          const res = await fetch(`/api/teacher/classrooms/${classroom.id}/announcements`)
          if (!res.ok) throw new Error('Failed to load announcements')
          return res.json()
        },
        20_000,
      )
      setAnnouncements(data.announcements || [])
    } catch (err) {
      console.error('Error loading announcements:', err)
    } finally {
      setLoading(false)
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

  if (loading) {
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
            <Button
              type="button"
              variant="primary"
              onClick={() => setIsCreating(true)}
              disabled={isCreating || saving}
              aria-label="New announcement"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>New</span>
            </Button>
          }
          centerPlacement="floating"
        />
      )}

      {isReadOnly && (
        <div className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
          This classroom is archived. Announcements are read-only.
        </div>
      )}

      {/* New announcement form */}
      {isCreating ? (
        <div className="bg-surface rounded-lg border border-border p-4">
          <FormField label="Title" className="mb-3" hideLabel>
            <Input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              disabled={saving}
              maxLength={ANNOUNCEMENT_TITLE_MAX_LENGTH}
              placeholder="Title (optional)"
            />
          </FormField>
          <textarea
            ref={newTextareaRef}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            onKeyDown={handleNewKeyDown}
            disabled={saving}
            rows={6}
            className="max-h-[50vh] min-h-[10rem] w-full resize-y overflow-y-auto rounded-md border border-border bg-surface-2 px-3 py-2 text-sm leading-6 text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            placeholder="Write an announcement..."
          />
          {scheduleDateTime && (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const { date, time } = parseDateTime(scheduleDateTime)
                  setPendingScheduleDate(date)
                  setPendingScheduleTime(time)
                  setShowScheduleDropdown(true)
                }}
                className="flex items-center gap-2 text-sm text-amber-600 hover:text-amber-700"
              >
                <Calendar className="h-4 w-4 flex-shrink-0" />
                <span>{formatDate(scheduleDateTime)}</span>
              </button>
              <button
                type="button"
                onClick={() => setScheduleDateTime('')}
                className="text-xs text-text-muted hover:text-text-default"
              >
                Clear
              </button>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setIsCreating(false)
                setNewTitle('')
                setNewContent('')
                setScheduleDateTime('')
                setShowScheduleDropdown(false)
              }}
              className="text-sm text-text-muted hover:text-text-default"
            >
              Cancel
            </button>
            <div className="relative flex items-center" ref={dropdownRef}>
              {scheduleDateTime ? (
                <Button
                  variant="primary"
                  size="sm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => createAnnouncement(scheduleDateTime)}
                  disabled={saving || !newContent.trim()}
                >
                  {saving ? 'Scheduling...' : 'Schedule'}
                </Button>
              ) : (
                <SplitButton
                  label={saving ? 'Posting...' : 'Post'}
                  onPrimaryClick={() => createAnnouncement()}
                  disabled={saving || !newContent.trim()}
                  options={[
                    {
                      id: 'schedule',
                      label: 'Schedule...',
                      onSelect: openCreateSchedulePicker,
                    },
                  ]}
                  toggleAriaLabel="Choose announcement action"
                  primaryButtonProps={{
                    onMouseDown: (e) => e.preventDefault(),
                  }}
                />
              )}

              {showScheduleDropdown && (
                <ScheduleDateTimePicker
                  className="absolute right-0 top-full z-10 mt-1 min-w-[220px]"
                  date={pendingScheduleDate}
                  time={pendingScheduleTime}
                  minDate={getTodayDate()}
                  isFutureValid={!pendingScheduleDate ? false : isScheduleInFuture(pendingScheduleDate, pendingScheduleTime)}
                  onDateChange={setPendingScheduleDate}
                  onTimeChange={setPendingScheduleTime}
                  onCancel={() => setShowScheduleDropdown(false)}
                  onConfirm={() => {
                    if (pendingScheduleDate && isScheduleInFuture(pendingScheduleDate, pendingScheduleTime)) {
                      setScheduleDateTime(combineDateTime(pendingScheduleDate, pendingScheduleTime))
                      setShowScheduleDropdown(false)
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Empty state */}
      {announcements.length === 0 && !isCreating && (
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <p className="text-sm text-text-muted">
            No announcements yet. Create one to share updates with your students.
          </p>
        </div>
      )}

      {/* Announcements list */}
      {announcements.length > 0 && (() => {
        const sortedAnnouncements = sortAnnouncementsNewestFirst(announcements)
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
                {editingId === announcement.id ? (
                  // Editing mode
                  <div className="space-y-3">
                    <FormField label="Title" hideLabel>
                      <Input
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                        disabled={saving}
                        maxLength={ANNOUNCEMENT_TITLE_MAX_LENGTH}
                        placeholder="Title (optional)"
                      />
                    </FormField>
                    <textarea
                      ref={editTextareaRef}
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      onKeyDown={handleEditKeyDown}
                      disabled={saving}
                      rows={6}
                      className="max-h-[50vh] min-h-[10rem] w-full resize-y overflow-y-auto rounded-md border border-border bg-surface-2 px-3 py-2 text-sm leading-6 text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                    />
                    {/* Show scheduled date if set */}
                    {editScheduleDateTime && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const { date, time } = parseDateTime(editScheduleDateTime)
                            setPendingEditScheduleDate(date)
                            setPendingEditScheduleTime(time)
                            setShowEditScheduleDropdown(true)
                          }}
                          className="flex items-center gap-2 text-sm text-amber-600 hover:text-amber-700"
                        >
                          <Calendar className="h-4 w-4 flex-shrink-0" />
                          <span>{formatDate(editScheduleDateTime)}</span>
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setEditScheduleDateTime('')}
                          disabled={saving}
                          className="text-xs text-text-muted hover:text-text-default whitespace-nowrap"
                        >
                          Clear
                        </button>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={cancelEditing}
                        className="text-sm text-text-muted hover:text-text-default"
                      >
                        Cancel
                      </button>
                      <div className="relative flex items-center" ref={editDropdownRef}>
                        {editScheduleDateTime ? (
                          <Button
                            variant="primary"
                            size="sm"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => saveEdit()}
                            disabled={saving || !editContent.trim()}
                          >
                            {saving ? 'Saving...' : 'Save'}
                          </Button>
                        ) : (
                          <SplitButton
                            label={saving ? 'Saving...' : 'Post'}
                            onPrimaryClick={() => saveEdit()}
                            disabled={saving || !editContent.trim()}
                            options={[
                              {
                                id: 'schedule',
                                label: 'Schedule...',
                                onSelect: openEditSchedulePicker,
                              },
                            ]}
                            toggleAriaLabel="Choose announcement action"
                            primaryButtonProps={{
                              onMouseDown: (e) => e.preventDefault(),
                            }}
                          />
                        )}

                        {/* Schedule dropdown */}
                        {showEditScheduleDropdown && (
                          <ScheduleDateTimePicker
                            className="absolute right-0 top-full mt-1 z-10 min-w-[220px]"
                            date={pendingEditScheduleDate}
                            time={pendingEditScheduleTime}
                            minDate={getTodayDate()}
                            isFutureValid={!pendingEditScheduleDate ? false : isScheduleInFuture(pendingEditScheduleDate, pendingEditScheduleTime)}
                            onDateChange={setPendingEditScheduleDate}
                            onTimeChange={setPendingEditScheduleTime}
                            onCancel={() => setShowEditScheduleDropdown(false)}
                            onConfirm={() => {
                              if (pendingEditScheduleDate && isScheduleInFuture(pendingEditScheduleDate, pendingEditScheduleTime)) {
                                setEditScheduleDateTime(combineDateTime(pendingEditScheduleDate, pendingEditScheduleTime))
                                setShowEditScheduleDropdown(false)
                              }
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  // View mode
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
                )}
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
