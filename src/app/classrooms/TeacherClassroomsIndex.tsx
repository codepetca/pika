'use client'

import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Plus } from 'lucide-react'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import { ConfirmDialog } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { ACTIONBAR_BUTTON_PRIMARY_CLASSNAME, PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import type { Classroom } from '@/types'

interface Props {
  initialClassrooms: Classroom[]
}

type ViewMode = 'active' | 'archived'

type PendingAction =
  | { mode: 'archive' | 'restore' | 'delete'; classroom: Classroom }
  | null

export function TeacherClassroomsIndex({ initialClassrooms }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const lastPathRef = useRef(pathname)
  const [activeClassrooms, setActiveClassrooms] = useState<Classroom[]>(initialClassrooms)
  const [archivedClassrooms, setArchivedClassrooms] = useState<Classroom[]>([])
  const [view, setView] = useState<ViewMode>('active')
  const [showCreate, setShowCreate] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isLoadingArchived, setIsLoadingArchived] = useState(false)
  const [error, setError] = useState('')

  const sortedActive = useMemo(() => {
    return [...activeClassrooms].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }, [activeClassrooms])

  const sortedArchived = useMemo(() => {
    return [...archivedClassrooms].sort((a, b) => {
      const aKey = a.archived_at || a.updated_at
      const bKey = b.archived_at || b.updated_at
      return bKey.localeCompare(aKey)
    })
  }, [archivedClassrooms])

  const visibleClassrooms = view === 'active' ? sortedActive : sortedArchived

  const loadArchived = useCallback(async () => {
    setIsLoadingArchived(true)
    setError('')
    try {
      const res = await fetch('/api/teacher/classrooms?archived=true')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load archived classrooms')
      }
      setArchivedClassrooms(data.classrooms || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load archived classrooms')
    } finally {
      setIsLoadingArchived(false)
    }
  }, [])

  // Fetch fresh classroom data to handle stale router cache
  const refreshActiveClassrooms = useCallback(async () => {
    try {
      const res = await fetch('/api/teacher/classrooms')
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.classrooms) {
        setActiveClassrooms(data.classrooms)
      }
    } catch {
      // Silently fail - we still have initialClassrooms
    }
  }, [])

  // Sync from server-provided data when it changes
  useEffect(() => {
    setActiveClassrooms(initialClassrooms)
  }, [initialClassrooms])

  // Refetch when navigating back to this page (not on initial mount — server data is fresh)
  useEffect(() => {
    if (pathname === '/classrooms' && lastPathRef.current !== '/classrooms') {
      refreshActiveClassrooms()
    }
    lastPathRef.current = pathname
  }, [pathname, refreshActiveClassrooms])

  useEffect(() => {
    if (view !== 'archived') return
    loadArchived()
  }, [loadArchived, view])

  async function archiveClassroom(classroom: Classroom) {
    setIsProcessing(true)
    setError('')
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived: true }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to archive classroom')
      }
      const updated = data.classroom || classroom
      setActiveClassrooms((prev) => prev.filter((c) => c.id !== classroom.id))
      setArchivedClassrooms((prev) => [updated, ...prev.filter((c) => c.id !== classroom.id)])
    } catch (err: any) {
      setError(err.message || 'Failed to archive classroom')
    } finally {
      setIsProcessing(false)
      setPendingAction(null)
    }
  }

  async function restoreClassroom(classroom: Classroom) {
    setIsProcessing(true)
    setError('')
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived: false }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to restore classroom')
      }
      const updated = data.classroom || classroom
      setArchivedClassrooms((prev) => prev.filter((c) => c.id !== classroom.id))
      setActiveClassrooms((prev) => [updated, ...prev.filter((c) => c.id !== classroom.id)])
    } catch (err: any) {
      setError(err.message || 'Failed to restore classroom')
    } finally {
      setIsProcessing(false)
      setPendingAction(null)
    }
  }

  async function deleteClassroom(classroom: Classroom) {
    setIsProcessing(true)
    setError('')
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete classroom')
      }
      setArchivedClassrooms((prev) => prev.filter((c) => c.id !== classroom.id))
    } catch (err: any) {
      setError(err.message || 'Failed to delete classroom')
    } finally {
      setIsProcessing(false)
      setPendingAction(null)
    }
  }

  async function handleConfirmAction() {
    if (!pendingAction) return
    const { classroom, mode } = pendingAction

    if (mode === 'archive') {
      await archiveClassroom(classroom)
      return
    }

    if (mode === 'restore') {
      await restoreClassroom(classroom)
      return
    }

    await deleteClassroom(classroom)
  }

  const newClassroomButton = (
    <button
      type="button"
      className={`${ACTIONBAR_BUTTON_PRIMARY_CLASSNAME} flex items-center gap-1`}
      onClick={() => setShowCreate(true)}
      aria-label="New classroom"
    >
      <Plus className="h-5 w-5" aria-hidden="true" />
      <span>New</span>
    </button>
  )

  const dialogTitle = pendingAction
    ? pendingAction.mode === 'archive'
      ? `Archive ${pendingAction.classroom.title}?`
      : pendingAction.mode === 'restore'
        ? `Restore ${pendingAction.classroom.title}?`
        : `Delete ${pendingAction.classroom.title}?`
    : ''

  const dialogDescription = pendingAction
    ? pendingAction.mode === 'archive'
      ? 'Students will lose access until the classroom is restored.'
      : pendingAction.mode === 'restore'
        ? 'Students will regain access to this classroom.'
        : 'This permanently deletes the classroom and all related data.'
    : undefined

  const dialogConfirmLabel = pendingAction
    ? pendingAction.mode === 'archive'
      ? 'Archive'
      : pendingAction.mode === 'restore'
        ? 'Restore'
        : 'Delete'
    : 'Confirm'

  const dialogVariant = pendingAction?.mode === 'delete' ? 'danger' : 'default'

  return (
    <PageLayout className="max-w-5xl mx-auto">
      <PageActionBar
        primary={
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-text-default">Classrooms</h1>
            <div className="inline-flex rounded-md border border-border bg-surface">
              <button
                type="button"
                onClick={() => setView('active')}
                className={[
                  'px-3 py-1.5 text-sm font-medium rounded-l-md',
                  view === 'active'
                    ? 'bg-primary text-text-inverse'
                    : 'text-text-muted hover:bg-surface-hover',
                ].join(' ')}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setView('archived')}
                className={[
                  'px-3 py-1.5 text-sm font-medium rounded-r-md',
                  view === 'archived'
                    ? 'bg-primary text-text-inverse'
                    : 'text-text-muted hover:bg-surface-hover',
                ].join(' ')}
              >
                Archived
              </button>
            </div>
          </div>
        }
        trailing={newClassroomButton}
      />

      <PageContent>
        {error && (
          <div className="mb-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {view === 'archived' && isLoadingArchived ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : visibleClassrooms.length === 0 ? (
          <div className="bg-surface rounded-lg shadow-sm border border-border p-10 text-center">
            <h2 className="text-lg font-semibold text-text-default">
              {view === 'active' ? 'No classrooms yet' : 'No archived classrooms'}
            </h2>
            <p className="text-text-muted mt-2">
              {view === 'active'
                ? 'Create your first classroom to get started.'
                : 'Archived classrooms will appear here.'}
            </p>
            {view === 'active' && (
              <div className="mt-6">
                <button
                  type="button"
                  className={`${ACTIONBAR_BUTTON_PRIMARY_CLASSNAME} flex items-center gap-1`}
                  onClick={() => setShowCreate(true)}
                  aria-label="New classroom"
                >
                  <Plus className="h-5 w-5" aria-hidden="true" />
                  <span>New</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-surface rounded-lg shadow-sm border border-border divide-y divide-border">
            {visibleClassrooms.map((c) => (
              <div key={c.id} className="flex items-center gap-4 p-4">
                <button
                  type="button"
                  data-testid="classroom-card"
                  onClick={() => router.push(`/classrooms/${c.id}?tab=attendance`)}
                  className="flex-1 text-left rounded-md -m-2 p-2 hover:bg-surface-hover"
                >
                  <div className="text-sm font-semibold text-text-default">{c.title}</div>
                  <div className="mt-1 text-sm text-text-muted">
                    Code: <span className="font-mono">{c.class_code}</span>
                    {c.term_label ? ` • ${c.term_label}` : ''}
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  {view === 'active' ? (
                    <button
                      type="button"
                      onClick={() => setPendingAction({ mode: 'archive', classroom: c })}
                      className="px-3 py-1.5 rounded-md text-xs font-medium border border-border text-text-default hover:bg-surface-hover"
                    >
                      Archive
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setPendingAction({ mode: 'restore', classroom: c })}
                        className="px-3 py-1.5 rounded-md text-xs font-medium border border-border text-text-default hover:bg-surface-hover"
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingAction({ mode: 'delete', classroom: c })}
                        className="px-3 py-1.5 rounded-md text-xs font-medium border border-danger text-danger hover:bg-danger-bg"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </PageContent>

      <CreateClassroomModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={(created) => {
          setShowCreate(false)
          setActiveClassrooms((prev) => [created, ...prev])
          router.push(`/classrooms/${created.id}?tab=attendance`)
        }}
      />

      <ConfirmDialog
        isOpen={!!pendingAction}
        title={dialogTitle}
        description={dialogDescription}
        confirmLabel={isProcessing ? 'Working…' : dialogConfirmLabel}
        cancelLabel="Cancel"
        confirmVariant={dialogVariant}
        isConfirmDisabled={isProcessing}
        isCancelDisabled={isProcessing}
        onCancel={() => (isProcessing ? null : setPendingAction(null))}
        onConfirm={handleConfirmAction}
      />
    </PageLayout>
  )
}
