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
import { Archive, CircleDot, LoaderCircle, Plus } from 'lucide-react'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import { TeacherEditModeControls } from '@/components/teacher-work-surface/TeacherEditModeControls'
import { Button, ConfirmDialog, SegmentedControl } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { PageContent, PageLayout } from '@/components/PageLayout'
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
  const [isEditingClassrooms, setIsEditingClassrooms] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isLoadingArchived, setIsLoadingArchived] = useState(false)
  const [isReordering, setIsReordering] = useState(false)
  const [draggingClassroomId, setDraggingClassroomId] = useState<string | null>(null)
  const [openingClassroomId, setOpeningClassroomId] = useState<string | null>(null)
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
    if (!isEditingClassrooms || view !== 'active' || isReordering) return

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
  }, [activeClassrooms, isEditingClassrooms, isReordering, refreshActiveClassrooms, view])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    if (!isEditingClassrooms) return
    setDraggingClassroomId(String(event.active.id))
  }, [isEditingClassrooms])

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

  useEffect(() => {
    function clearEditMode() {
      setIsEditingClassrooms(false)
      setDraggingClassroomId(null)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        clearEditMode()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('pageshow', clearEditMode)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('pageshow', clearEditMode)
    }
  }, [])

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
  const showCreateClassroomButton = activeClassrooms.length === 0 || isEditingClassrooms

  const openClassroom = useCallback((classroom: Classroom) => {
    setOpeningClassroomId(classroom.id)
    router.push(`/classrooms/${classroom.id}?tab=attendance`)
  }, [router])

  return (
    <PageLayout className="mx-auto max-w-2xl">
      <PageContent className="pb-24">
        {error && (
          <div className="mb-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {view === 'active' && visibleClassrooms.length > 1 && isReordering && (
          <p className="mb-3 text-sm text-text-muted">Saving…</p>
        )}

        {view === 'archived' && isLoadingArchived ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : visibleClassrooms.length === 0 ? (
          view === 'active' ? (
            /* Empty active: center the CTA on screen */
            <div className="flex flex-col items-center justify-center" style={{ minHeight: 'calc(100dvh - 12rem)' }}>
              <p className="text-sm text-text-muted">Create your first classroom</p>
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="mt-4"
                onClick={() => setShowCreate(true)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>New</span>
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm font-medium text-text-default">No archived classrooms</p>
              <p className="mt-1 text-sm text-text-muted">
                Archived classrooms will appear here so you can restore or permanently remove them later.
              </p>
              {showCreateClassroomButton ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="mt-4"
                  onClick={() => setShowCreate(true)}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>New</span>
                </Button>
              ) : null}
            </div>
          )
        ) : (
          <div className="flex flex-col gap-2">
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
                      showEditControls={isEditingClassrooms}
                      isDragDisabled={isReordering || openingClassroomId !== null}
                      isDisabled={openingClassroomId !== null}
                      isOpening={openingClassroomId === classroom.id}
                      onOpen={() => openClassroom(classroom)}
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
                  className="flex flex-col gap-3 rounded-card border border-border bg-surface px-5 py-4 shadow-elevated lg:grid lg:grid-cols-[minmax(0,1fr),auto] lg:items-center lg:gap-5"
                >
                  <button
                    type="button"
                    data-testid="classroom-card"
                    onClick={() => openClassroom(c)}
                    disabled={openingClassroomId !== null}
                    aria-busy={openingClassroomId === c.id}
                    className={[
                      '-m-1.5 min-w-0 rounded-control p-1.5 text-left transition-colors',
                      openingClassroomId === c.id ? 'cursor-wait bg-surface-accent' : 'hover:bg-surface-accent',
                    ].join(' ')}
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
                    {openingClassroomId === c.id && (
                      <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        Opening classroom...
                      </div>
                    )}
                  </button>
                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <Button
                      type="button"
                      variant="surface"
                      size="xs"
                      onClick={() => setPendingAction({ mode: 'restore', classroom: c })}
                      disabled={openingClassroomId !== null}
                    >
                      Restore
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => setPendingAction({ mode: 'delete', classroom: c })}
                      className="text-danger hover:bg-danger-bg"
                      disabled={openingClassroomId !== null}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {visibleClassrooms.length > 0 && showCreateClassroomButton ? (
          <div className="flex justify-center pt-3">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>New</span>
            </Button>
          </div>
        ) : null}
      </PageContent>

      <div
        data-testid="classroom-bottom-controls"
        className="fixed bottom-4 left-1/2 z-40 w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 rounded-lg bg-surface/95 p-1 shadow-elevated backdrop-blur"
      >
        <div className="flex items-center gap-1">
          <SegmentedControl<ViewMode>
            ariaLabel="Classroom view"
            value={view}
            onChange={setView}
            iconOnly={!isEditingClassrooms}
            className="border border-border shadow-sm"
            options={[
              {
                value: 'active',
                label: 'Active',
                icon: <CircleDot className="h-3.5 w-3.5" />,
              },
              {
                value: 'archived',
                label: 'Archived',
                icon: <Archive className="h-3.5 w-3.5" />,
              },
            ]}
          />
          <TeacherEditModeControls
            active={isEditingClassrooms}
            onActiveChange={(active) => {
              setIsEditingClassrooms(active)
              if (!active) {
                setDraggingClassroomId(null)
              }
            }}
            disabled={openingClassroomId !== null}
          />
        </div>
      </div>

      <CreateClassroomModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={(created) => {
          setShowCreate(false)
          setActiveClassrooms((prev) => [created, ...prev])
          openClassroom(created)
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
