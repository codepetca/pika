'use client'

import { useCallback, useEffect, useState, useId } from 'react'
import { Pencil, Trash2, Plus } from 'lucide-react'
import { Button, ConfirmDialog } from '@/ui'
import { Spinner } from '@/components/Spinner'
import type { Announcement, Classroom } from '@/types'

interface Props {
  classroom: Classroom
}

type FormMode = { type: 'closed' } | { type: 'create' } | { type: 'edit'; announcement: Announcement }

export function TeacherAnnouncementsSection({ classroom }: Props) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [formMode, setFormMode] = useState<FormMode>({ type: 'closed' })
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null)
  const [deleting, setDeleting] = useState(false)

  const titleId = useId()
  const contentId = useId()
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

  function openCreateForm() {
    setFormMode({ type: 'create' })
    setTitle('')
    setContent('')
    setError(null)
  }

  function openEditForm(announcement: Announcement) {
    setFormMode({ type: 'edit', announcement })
    setTitle(announcement.title)
    setContent(announcement.content)
    setError(null)
  }

  function closeForm() {
    setFormMode({ type: 'closed' })
    setTitle('')
    setContent('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !content.trim()) {
      setError('Title and content are required')
      return
    }

    setSaving(true)
    setError(null)

    try {
      if (formMode.type === 'create') {
        const res = await fetch(`/api/teacher/classrooms/${classroom.id}/announcements`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), content: content.trim() }),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to create announcement')
        }
        const data = await res.json()
        setAnnouncements((prev) => [data.announcement, ...prev])
      } else if (formMode.type === 'edit') {
        const res = await fetch(
          `/api/teacher/classrooms/${classroom.id}/announcements/${formMode.announcement.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title.trim(), content: content.trim() }),
          }
        )
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update announcement')
        }
        const data = await res.json()
        setAnnouncements((prev) =>
          prev.map((a) => (a.id === data.announcement.id ? data.announcement : a))
        )
      }
      closeForm()
    } catch (err: any) {
      setError(err.message || 'An error occurred')
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
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete announcement')
      }
      setAnnouncements((prev) => prev.filter((a) => a.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (err: any) {
      console.error('Delete error:', err)
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {isReadOnly && (
        <div className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
          This classroom is archived. Announcements are read-only.
        </div>
      )}

      {/* Form for create/edit */}
      {formMode.type !== 'closed' && (
        <div className="bg-surface rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold text-text-default mb-4">
            {formMode.type === 'create' ? 'New Announcement' : 'Edit Announcement'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor={titleId} className="block text-sm font-medium text-text-default mb-1">
                Title
              </label>
              <input
                id={titleId}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={saving}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                placeholder="Enter announcement title"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor={contentId} className="block text-sm font-medium text-text-default mb-1">
                Content
              </label>
              <textarea
                id={contentId}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={saving}
                rows={4}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 resize-none"
                placeholder="Enter announcement content"
              />
            </div>
            {error && <div className="text-sm text-danger">{error}</div>}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" onClick={closeForm} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Saving...' : formMode.type === 'create' ? 'Post' : 'Save'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Header with create button */}
      {formMode.type === 'closed' && !isReadOnly && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={openCreateForm}>
            <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
            New Announcement
          </Button>
        </div>
      )}

      {/* Empty state */}
      {announcements.length === 0 && formMode.type === 'closed' && (
        <div className="bg-surface rounded-lg border border-border p-8 text-center">
          <p className="text-text-muted">
            No announcements yet. Create one to share updates with your students.
          </p>
        </div>
      )}

      {/* Announcements list */}
      {announcements.length > 0 && (
        <div className="space-y-3">
          {announcements.map((announcement) => (
            <div
              key={announcement.id}
              className="bg-surface rounded-lg border border-border p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h4 className="text-base font-semibold text-text-default">
                    {announcement.title}
                  </h4>
                  <p className="text-xs text-text-muted mt-0.5">
                    {formatDate(announcement.created_at)}
                    {announcement.updated_at !== announcement.created_at && ' (edited)'}
                  </p>
                </div>
                {!isReadOnly && (
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditForm(announcement)}
                      aria-label="Edit announcement"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(announcement)}
                      aria-label="Delete announcement"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </div>
              <p className="mt-3 text-sm text-text-default whitespace-pre-wrap">
                {announcement.content}
              </p>
            </div>
          ))}
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
