'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { Trash2, Plus, Clock, ChevronDown, Calendar } from 'lucide-react'
import { Button, ConfirmDialog } from '@/ui'
import { Spinner } from '@/components/Spinner'
import type { Announcement, Classroom } from '@/types'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'

interface Props {
  classroom: Classroom
}

// Helper to check if announcement is scheduled (not yet published)
function isScheduled(announcement: Announcement): boolean {
  if (!announcement.scheduled_for) return false
  return new Date(announcement.scheduled_for) > new Date()
}

// Helper to get today's date in YYYY-MM-DD format
function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

// Helper to combine date and optional time into Date object
function combineDateTimeToDate(date: string, time?: string): Date {
  if (time) {
    return new Date(`${date}T${time}`)
  }
  // Default to 7:00 AM if no time specified
  return new Date(`${date}T07:00`)
}

// Helper to combine date and optional time into ISO string
function combineDateTime(date: string, time?: string): string {
  return combineDateTimeToDate(date, time).toISOString()
}

// Helper to check if date/time is in the future
function isScheduleInFuture(date: string, time?: string): boolean {
  const scheduledDate = combineDateTimeToDate(date, time)
  return scheduledDate > new Date()
}

// Helper to parse ISO datetime into date and time parts
function parseDateTime(isoString: string): { date: string; time: string } {
  const d = new Date(isoString)
  const date = d.toISOString().slice(0, 10)
  const time = d.toTimeString().slice(0, 5)
  return { date, time }
}

export function TeacherAnnouncementsSection({ classroom }: Props) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [editScheduleDateTime, setEditScheduleDateTime] = useState('')
  const [originalScheduledFor, setOriginalScheduledFor] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
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

  // Focus textarea when creating
  useEffect(() => {
    if (isCreating && newTextareaRef.current) {
      newTextareaRef.current.focus()
    }
  }, [isCreating])

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
    setEditContent(announcement.content)
    setOriginalContent(announcement.content)
    // Convert ISO to local datetime-local format if scheduled
    if (announcement.scheduled_for) {
      const date = new Date(announcement.scheduled_for)
      setEditScheduleDateTime(date.toISOString().slice(0, 16))
      setOriginalScheduledFor(announcement.scheduled_for)
    } else {
      setEditScheduleDateTime('')
      setOriginalScheduledFor(null)
    }
  }

  function cancelEditing() {
    setEditingId(null)
    setEditContent('')
    setOriginalContent('')
    setEditScheduleDateTime('')
    setOriginalScheduledFor(null)
    setShowEditScheduleDropdown(false)
  }

  async function saveEdit() {
    if (!editingId || !editContent.trim() || saving) return

    // Check if anything changed
    const contentChanged = editContent.trim() !== originalContent.trim()
    const newScheduledFor = editScheduleDateTime ? new Date(editScheduleDateTime).toISOString() : null
    const scheduleChanged = newScheduledFor !== originalScheduledFor

    // Don't save if nothing changed
    if (!contentChanged && !scheduleChanged) {
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
              content: editContent.trim(),
              scheduled_for: optimisticScheduledFor,
              updated_at: new Date().toISOString(),
            }
          : a,
      ),
    )
    try {
      const body: { content?: string; scheduled_for?: string | null } = {}
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
    const tempId = `temp-${Date.now()}`
    const now = new Date().toISOString()
    const optimisticAnnouncement: Announcement = {
      id: tempId,
      classroom_id: classroom.id,
      content: newContent.trim(),
      created_by: classroom.teacher_id,
      scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
      created_at: now,
      updated_at: now,
    }
    setAnnouncements((prev) => [optimisticAnnouncement, ...prev])
    try {
      const body: { content: string; scheduled_for?: string } = { content: newContent.trim() }
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
      setNewContent('')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {isReadOnly && (
        <div className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
          This classroom is archived. Announcements are read-only.
        </div>
      )}

      {/* New announcement form */}
      {isCreating ? (
        <div className="bg-surface rounded-lg border border-border p-4">
          <textarea
            ref={newTextareaRef}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            onKeyDown={handleNewKeyDown}
            disabled={saving}
            rows={3}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 resize-none"
            placeholder="Write an announcement..."
          />
          {/* Show scheduled date if set */}
          {scheduleDateTime && (
            <div className="flex items-center gap-2 mt-2">
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
          <div className="flex items-center justify-between mt-2">
            <button
              type="button"
              onClick={() => {
                setIsCreating(false)
                setNewContent('')
                setScheduleDateTime('')
                setShowScheduleDropdown(false)
              }}
              className="text-sm text-text-muted hover:text-text-default"
            >
              Cancel
            </button>
            <div className="relative flex items-center" ref={dropdownRef}>
              <Button
                variant="primary"
                size="sm"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => createAnnouncement(scheduleDateTime || undefined)}
                disabled={saving || !newContent.trim()}
                className={scheduleDateTime ? '' : 'rounded-r-none'}
              >
                {saving ? (scheduleDateTime ? 'Scheduling...' : 'Posting...') : (scheduleDateTime ? 'Schedule' : 'Post')}
              </Button>
              {!scheduleDateTime && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setPendingScheduleDate(getTodayDate())
                    setPendingScheduleTime('07:00')
                    setShowScheduleDropdown(!showScheduleDropdown)
                  }}
                  disabled={saving || !newContent.trim()}
                  className="inline-flex items-center justify-center h-8 px-2 bg-primary text-white rounded-r-md border-l border-primary-hover hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              )}

              {/* Schedule dropdown */}
              {showScheduleDropdown && (
                <div className="absolute right-0 top-full mt-1 bg-surface rounded-lg shadow-lg border border-border p-3 z-10 min-w-[220px]">
                  <div className="flex items-center gap-2 mb-3">
                    <Calendar className="h-4 w-4 text-text-muted" />
                    <span className="text-sm font-medium text-text-default">Schedule</span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Date</label>
                      <input
                        type="date"
                        value={pendingScheduleDate}
                        onChange={(e) => setPendingScheduleDate(e.target.value)}
                        min={getTodayDate()}
                        className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Time</label>
                      <input
                        type="time"
                        value={pendingScheduleTime}
                        onChange={(e) => setPendingScheduleTime(e.target.value)}
                        className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  {pendingScheduleDate && !isScheduleInFuture(pendingScheduleDate, pendingScheduleTime) && (
                    <p className="text-xs text-red-500 mt-2">Schedule must be in the future</p>
                  )}
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      if (pendingScheduleDate && isScheduleInFuture(pendingScheduleDate, pendingScheduleTime)) {
                        setScheduleDateTime(combineDateTime(pendingScheduleDate, pendingScheduleTime))
                        setShowScheduleDropdown(false)
                      }
                    }}
                    disabled={!pendingScheduleDate || !isScheduleInFuture(pendingScheduleDate, pendingScheduleTime)}
                    className="w-full mt-2"
                  >
                    Done
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        !isReadOnly && (
          <div className="flex justify-center">
            <Button variant="primary" onClick={() => setIsCreating(true)}>
              <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
              New Announcement
            </Button>
          </div>
        )
      )}

      {/* Empty state */}
      {announcements.length === 0 && !isCreating && (
        <div className="bg-surface rounded-lg border border-border p-8 text-center">
          <p className="text-text-muted">
            No announcements yet. Create one to share updates with your students.
          </p>
        </div>
      )}

      {/* Announcements list */}
      {announcements.length > 0 && (() => {
        // Sort: scheduled announcements first (by scheduled_for), then published (by created_at)
        const sortedAnnouncements = [...announcements].sort((a, b) => {
          const aScheduled = isScheduled(a)
          const bScheduled = isScheduled(b)
          if (aScheduled && !bScheduled) return -1
          if (!aScheduled && bScheduled) return 1
          if (aScheduled && bScheduled) {
            return new Date(a.scheduled_for!).getTime() - new Date(b.scheduled_for!).getTime()
          }
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        })
        const displayedAnnouncements = showAll ? sortedAnnouncements : sortedAnnouncements.slice(0, 5)

        return (
        <div className="space-y-3">
          {displayedAnnouncements.map((announcement) => {
            const scheduled = isScheduled(announcement)

            return (
              <div
                key={announcement.id}
                className={`bg-surface rounded-lg border p-4 ${
                  scheduled ? 'border-amber-500/50 bg-amber-500/5' : 'border-border'
                }`}
              >
                {editingId === announcement.id ? (
                  // Editing mode
                  <div>
                    <textarea
                      ref={editTextareaRef}
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      onKeyDown={handleEditKeyDown}
                      disabled={saving}
                      rows={3}
                      className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 resize-none"
                    />
                    {/* Show scheduled date if set */}
                    {editScheduleDateTime && (
                      <div className="flex items-center gap-2 mt-2">
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
                    <div className="flex items-center justify-between mt-2">
                      <button
                        type="button"
                        onClick={cancelEditing}
                        className="text-sm text-text-muted hover:text-text-default"
                      >
                        Cancel
                      </button>
                      <div className="relative flex items-center" ref={editDropdownRef}>
                        <Button
                          variant="primary"
                          size="sm"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => saveEdit()}
                          disabled={saving || !editContent.trim()}
                          className={editScheduleDateTime ? '' : 'rounded-r-none'}
                        >
                          {saving ? 'Saving...' : (editScheduleDateTime ? 'Save' : 'Post')}
                        </Button>
                        {!editScheduleDateTime && (
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setPendingEditScheduleDate(getTodayDate())
                              setPendingEditScheduleTime('07:00')
                              setShowEditScheduleDropdown(!showEditScheduleDropdown)
                            }}
                            disabled={saving || !editContent.trim()}
                            className="inline-flex items-center justify-center h-8 px-2 bg-primary text-white rounded-r-md border-l border-primary-hover hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                        )}

                        {/* Schedule dropdown */}
                        {showEditScheduleDropdown && (
                          <div className="absolute right-0 top-full mt-1 bg-surface rounded-lg shadow-lg border border-border p-3 z-10 min-w-[220px]">
                            <div className="flex items-center gap-2 mb-3">
                              <Calendar className="h-4 w-4 text-text-muted" />
                              <span className="text-sm font-medium text-text-default">Schedule</span>
                            </div>
                            <div className="space-y-3">
                              <div>
                                <label className="block text-xs text-text-muted mb-1">Date</label>
                                <input
                                  type="date"
                                  value={pendingEditScheduleDate}
                                  onChange={(e) => setPendingEditScheduleDate(e.target.value)}
                                  min={getTodayDate()}
                                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-text-muted mb-1">Time</label>
                                <input
                                  type="time"
                                  value={pendingEditScheduleTime}
                                  onChange={(e) => setPendingEditScheduleTime(e.target.value)}
                                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                            </div>
                            {pendingEditScheduleDate && !isScheduleInFuture(pendingEditScheduleDate, pendingEditScheduleTime) && (
                              <p className="text-xs text-red-500 mt-2">Schedule must be in the future</p>
                            )}
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => {
                                if (pendingEditScheduleDate && isScheduleInFuture(pendingEditScheduleDate, pendingEditScheduleTime)) {
                                  setEditScheduleDateTime(combineDateTime(pendingEditScheduleDate, pendingEditScheduleTime))
                                  setShowEditScheduleDropdown(false)
                                }
                              }}
                              disabled={!pendingEditScheduleDate || !isScheduleInFuture(pendingEditScheduleDate, pendingEditScheduleTime)}
                              className="w-full mt-2"
                            >
                              Done
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  // View mode
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={`min-w-0 flex-1 ${!isReadOnly ? 'cursor-pointer' : ''}`}
                      onClick={() => startEditing(announcement)}
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
                      <p className={`text-sm whitespace-pre-wrap ${scheduled ? 'text-text-muted' : 'text-text-default'}`}>
                        {announcement.content}
                      </p>
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
