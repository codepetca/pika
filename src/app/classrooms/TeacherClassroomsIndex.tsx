'use client'

import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useRouter, usePathname } from 'next/navigation'
import { Plus } from 'lucide-react'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import { Button, Card, ConfirmDialog, EmptyState } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { ACTIONBAR_BUTTON_PRIMARY_CLASSNAME, PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import { ClassroomRowGhost, SortableClassroomRow } from '@/components/SortableClassroomRow'
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
  const [isReordering, setIsReordering] = useState(false)
  const [draggingClassroomId, setDraggingClassroomId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const sortedArchived = useMemo(() => {
    return [...archivedClassrooms].sort((a, b) => {
      const aKey = a.archived_at || a.updated_at
      const bKey = b.archived_at || b.updated_at
      return bKey.localeCompare(aKey)
    })
  }, [archivedClassrooms])

  const visibleClassrooms = view === 'active' ? activeClassrooms : sortedArchived
  const draggingClassroom = useMemo(
    () => activeClassrooms.find((classroom) => classroom.id === draggingClassroomId) ?? null,
    [activeClassrooms, draggingClassroomId]
  )

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

  const refreshActiveClassrooms = useCallback(async () => {
    try {
      const res = await fetch('/api/teacher/classrooms')
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.classrooms) {
        setActiveClassrooms(data.classrooms)
      }
    } catch {
      // Ignore; the page still has server-rendered data.
    }
  }, [])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    if (view !== 'active' || isReordering) return

    const { active, over } = event
    if (!over || active.id === over.id) {
      setDraggingClassroomId(null)
      return
    }

    const oldIndex = activeClassrooms.findIndex((classroom) => classroom.id === active.id)
    const newIndex = activeClassrooms.findIndex((classroom) => classroom.id === over.id)

    if (oldIndex === -1 || newIndex === -1) {
      setDraggingClassroomId(null)
      return
    }

    const reordered = arrayMove(activeClassrooms, oldIndex, newIndex)
    setActiveClassrooms(reordered)
    setError('')
    setIsReordering(true)

    try {
      const res = await fetch('/api/teacher/classrooms/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroom_ids: reordered.map((classroom) => classroom.id) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save classroom order')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save classroom order')
      refreshActiveClassrooms()
    } finally {
      setIsReordering(false)
      setDraggingClassroomId(null)
    }
  }, [activeClassrooms, isReordering, refreshActiveClassrooms, view])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingClassroomId(String(event.active.id))
  }, [])

  const handleDragCancel = useCallback(() => {
    setDraggingClassroomId(null)
  }, [])

  useEffect(() => {
    setActiveClassrooms(initialClassrooms)
  }, [initialClassrooms])

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
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      })
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
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: false }),
      })
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
    <PageLayout className="mx-auto max-w-6xl">
      <PageActionBar
        primary={
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-text-default">Classrooms</h1>
            <div className="inline-flex rounded-control border border-border bg-surface shadow-sm">
              <button
                type="button"
                onClick={() => setView('active')}
                className={[
                  'rounded-l-control px-3 py-1.5 text-sm font-medium transition-colors',
                  view === 'active'
                    ? 'bg-surface-selected text-text-default'
                    : 'text-text-muted hover:bg-surface-accent',
                ].join(' ')}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setView('archived')}
                className={[
                  'rounded-r-control px-3 py-1.5 text-sm font-medium transition-colors',
                  view === 'archived'
                    ? 'bg-surface-selected text-text-default'
                    : 'text-text-muted hover:bg-surface-accent',
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

        {view === 'active' && visibleClassrooms.length > 1 && (
          <p className="mb-3 text-sm text-text-muted">
            Drag the grip to reorder your classrooms.
            {isReordering ? ' Saving…' : ''}
          </p>
        )}

        {view === 'archived' && isLoadingArchived ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : visibleClassrooms.length === 0 ? (
          <EmptyState
            title={view === 'active' ? 'No classrooms yet' : 'No archived classrooms'}
            description={
              view === 'active'
                ? 'Create your first classroom to start managing students, assignments, and attendance.'
                : 'Archived classrooms will appear here so you can restore or permanently remove them later.'
            }
            action={
              view === 'active' ? (
                <Button onClick={() => setShowCreate(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>New classroom</span>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Card tone="panel" padding="none" className="overflow-hidden">
            {view === 'active' ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragCancel={handleDragCancel}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={activeClassrooms.map((classroom) => classroom.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {activeClassrooms.map((classroom) => (
                    <SortableClassroomRow
                      key={classroom.id}
                      classroom={classroom}
                      isDragDisabled={isReordering}
                      onOpen={() => router.push(`/classrooms/${classroom.id}?tab=attendance`)}
                      onArchive={() => setPendingAction({ mode: 'archive', classroom })}
                    />
                  ))}
                </SortableContext>
                <DragOverlay>
                  {draggingClassroom ? (
                    <ClassroomRowGhost classroom={draggingClassroom} />
                  ) : null}
                </DragOverlay>
              </DndContext>
            ) : (
              sortedArchived.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-col gap-3 border-b border-border px-5 py-4 last:border-b-0 lg:grid lg:grid-cols-[minmax(0,1fr),auto] lg:items-center lg:gap-5"
                >
                  <button
                    type="button"
                    data-testid="classroom-card"
                    onClick={() => router.push(`/classrooms/${c.id}?tab=attendance`)}
                    className="-m-1.5 min-w-0 rounded-control p-1.5 text-left transition-colors hover:bg-surface-accent"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <div className="text-base font-semibold text-text-default">{c.title}</div>
                      {c.term_label && (
                        <div className="text-sm text-text-muted">{c.term_label}</div>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-text-muted">
                      Code: <span className="font-mono tracking-[0.18em]">{c.class_code}</span>
                    </div>
                  </button>
                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <Button
                      type="button"
                      variant="surface"
                      size="xs"
                      onClick={() => setPendingAction({ mode: 'restore', classroom: c })}
                    >
                      Restore
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => setPendingAction({ mode: 'delete', classroom: c })}
                      className="text-danger hover:bg-danger-bg"
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))
            )}
          </Card>
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
