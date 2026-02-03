'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { Button, ConfirmDialog } from '@/ui'
import { Spinner } from '@/components/Spinner'
import type { Announcement, Classroom } from '@/types'

interface Props {
  classroom: Classroom
}

export function TeacherAnnouncementsSection({ classroom }: Props) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null)
  const [deleting, setDeleting] = useState(false)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)
  const newTextareaRef = useRef<HTMLTextAreaElement>(null)

  const isReadOnly = !!classroom.archived_at

  const loadAnnouncements = useCallback(async () => {
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}/announcements`)
      if (!res.ok) throw new Error('Failed to load announcements')
      const data = await res.json()
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

  function startEditing(announcement: Announcement) {
    if (isReadOnly || saving) return
    setEditingId(announcement.id)
    setEditContent(announcement.content)
    setOriginalContent(announcement.content)
  }

  function cancelEditing() {
    setEditingId(null)
    setEditContent('')
    setOriginalContent('')
  }

  async function saveEdit() {
    if (!editingId || !editContent.trim() || saving) return

    // Don't save if content unchanged
    if (editContent.trim() === originalContent.trim()) {
      cancelEditing()
      return
    }

    setSaving(true)
    try {
      const res = await fetch(
        `/api/teacher/classrooms/${classroom.id}/announcements/${editingId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: editContent.trim() }),
        }
      )
      if (!res.ok) throw new Error('Failed to update')
      const data = await res.json()
      setAnnouncements((prev) =>
        prev.map((a) => (a.id === data.announcement.id ? data.announcement : a))
      )
      setEditingId(null)
      setEditContent('')
      setOriginalContent('')
    } catch (err) {
      console.error('Error updating announcement:', err)
    } finally {
      setSaving(false)
    }
  }

  async function createAnnouncement() {
    if (!newContent.trim() || saving) return

    setSaving(true)
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent.trim() }),
      })
      if (!res.ok) throw new Error('Failed to create')
      const data = await res.json()
      setAnnouncements((prev) => [data.announcement, ...prev])
      setIsCreating(false)
      setNewContent('')
    } catch (err) {
      console.error('Error creating announcement:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return

    setDeleting(true)
    try {
      const res = await fetch(
        `/api/teacher/classrooms/${classroom.id}/announcements/${deleteTarget.id}`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error('Failed to delete')
      setAnnouncements((prev) => prev.filter((a) => a.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (err) {
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
            onBlur={(e) => {
              // Don't save if clicking the Post button (it will handle it)
              if (e.relatedTarget?.getAttribute('data-save-button')) return
              if (newContent.trim()) {
                createAnnouncement()
              } else {
                setIsCreating(false)
                setNewContent('')
              }
            }}
            disabled={saving}
            rows={3}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 resize-none"
            placeholder="Write an announcement..."
          />
          <div className="flex justify-end mt-2">
            <Button
              variant="primary"
              size="sm"
              data-save-button="true"
              onClick={createAnnouncement}
              disabled={saving || !newContent.trim()}
            >
              {saving ? 'Posting...' : 'Post'}
            </Button>
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
      {announcements.length > 0 && (
        <div className="space-y-3">
          {(showAll ? announcements : announcements.slice(0, 5)).map((announcement) => (
            <div
              key={announcement.id}
              className="bg-surface rounded-lg border border-border p-4"
            >
              {editingId === announcement.id ? (
                // Editing mode
                <div>
                  <textarea
                    ref={editTextareaRef}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    onBlur={(e) => {
                      // Don't save if clicking the Save button (it will handle it)
                      if (e.relatedTarget?.getAttribute('data-save-button')) return
                      saveEdit()
                    }}
                    disabled={saving}
                    rows={3}
                    className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 resize-none"
                  />
                  <div className="flex justify-end mt-2">
                    <Button
                      variant="primary"
                      size="sm"
                      data-save-button="true"
                      onClick={saveEdit}
                      disabled={saving || !editContent.trim()}
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                </div>
              ) : (
                // View mode
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={`min-w-0 flex-1 ${!isReadOnly ? 'cursor-pointer' : ''}`}
                    onClick={() => startEditing(announcement)}
                  >
                    <p className="text-xs text-text-muted mb-2">
                      {formatDate(announcement.created_at)}
                      {announcement.updated_at !== announcement.created_at && ' (edited)'}
                    </p>
                    <p className="text-sm text-text-default whitespace-pre-wrap">
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
          ))}

          {!showAll && announcements.length > 5 && (
            <Button
              variant="secondary"
              onClick={() => setShowAll(true)}
              className="w-full"
            >
              Show {announcements.length - 5} older announcement{announcements.length - 5 === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      )}

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
