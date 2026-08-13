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
import { Archive, CircleDot, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import { ClassroomPurgeDialog } from '@/components/ClassroomPurgeDialog'
import { ColdClassroomPurgeDialog } from '@/components/ColdClassroomPurgeDialog'
import { ColdClassroomArchiveRow } from '@/components/ColdClassroomArchiveRow'
import { FloatingActionCluster } from '@/components/FloatingActionCluster'
import { TeacherEditModeControls } from '@/components/teacher-work-surface/TeacherEditModeControls'
import { Button, ConfirmDialog, PageContent, PageLayout, SegmentedControl } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { ClassroomRowGhost, SortableClassroomRow } from '@/components/SortableClassroomRow'
import type { Classroom } from '@/types'
import type { ClassroomColdArchiveSummary } from '@/lib/contracts/classroom-lifecycle'
import {
  fetchTeacherArchivedClassroomState,
  fetchTeacherClassrooms,
  invalidateTeacherClassrooms,
} from '@/lib/teacher-classrooms-client'
import { invalidateTeacherBlueprints } from '@/lib/teacher-blueprints-client'
import { formatClassroomDateRange } from '@/lib/classroom-date-range'
import { getClassroomThemeDefinition, getClassroomThemeStyle } from '@/lib/classroom-theme'

interface Props {
  initialClassrooms: Classroom[]
}

type ViewMode = 'active' | 'archived'

type PendingAction =
  | { mode: 'archive'; classroom: Classroom }
  | { mode: 'restore-hot'; classroom: Classroom }
  | { mode: 'restore-cold'; archive: ClassroomColdArchiveSummary }
  | null

type ReuseReview = {
  classroomTitle: string
  reviewUrl: string
} | null

export function TeacherClassroomsIndex({ initialClassrooms }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const lastPathRef = useRef(pathname)
  const coldRestoreOperationIdsRef = useRef(new Map<string, string>())
  const reuseOperationIdsRef = useRef(new Map<string, string>())
  const [activeClassrooms, setActiveClassrooms] = useState<Classroom[]>(initialClassrooms)
  const [archivedClassrooms, setArchivedClassrooms] = useState<Classroom[]>([])
  const [coldArchives, setColdArchives] = useState<ClassroomColdArchiveSummary[]>([])
  const [coldArchiveRestoreEnabled, setColdArchiveRestoreEnabled] = useState(false)
  const [hotClassroomPurgeEnabledIds, setHotClassroomPurgeEnabledIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [coldClassroomPurgeEnabledIds, setColdClassroomPurgeEnabledIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [view, setView] = useState<ViewMode>('active')
  const [showCreate, setShowCreate] = useState(false)
  const [reuseBlueprintId, setReuseBlueprintId] = useState<string | null>(null)
  const [reuseReview, setReuseReview] = useState<ReuseReview>(null)
  const [reusingClassroomId, setReusingClassroomId] = useState<string | null>(null)
  const [isEditingClassrooms, setIsEditingClassrooms] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [purgeClassroom, setPurgeClassroom] = useState<Classroom | null>(null)
  const [coldPurgeArchive, setColdPurgeArchive] = useState<ClassroomColdArchiveSummary | null>(null)
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
  const hasArchivedItems = sortedArchived.length > 0 || coldArchives.length > 0
  const draggingClassroom = useMemo(
    () => activeClassrooms.find((classroom) => classroom.id === draggingClassroomId) ?? null,
    [activeClassrooms, draggingClassroomId]
  )

  const loadArchived = useCallback(async () => {
    setIsLoadingArchived(true)
    setError('')
    try {
      const state = await fetchTeacherArchivedClassroomState()
      setArchivedClassrooms(state.classrooms)
      setColdArchives(state.coldArchives)
      setColdArchiveRestoreEnabled(state.coldArchiveRestoreEnabled)
      setHotClassroomPurgeEnabledIds(new Set(state.hotClassroomPurgeEnabledIds ?? []))
      setColdClassroomPurgeEnabledIds(new Set(state.coldClassroomPurgeEnabledIds ?? []))
      return true
    } catch (err: any) {
      setError(err.message || 'Failed to load archived classrooms')
      return false
    } finally {
      setIsLoadingArchived(false)
    }
  }, [])

  const refreshActiveClassrooms = useCallback(async () => {
    try {
      const classrooms = await fetchTeacherClassrooms()
      setActiveClassrooms(classrooms)
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
      invalidateTeacherClassrooms()
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
      setView('active')
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
      invalidateTeacherClassrooms()
      setActiveClassrooms((prev) => prev.filter((c) => c.id !== classroom.id))
      setArchivedClassrooms((prev) => [updated, ...prev.filter((c) => c.id !== classroom.id)])
    } catch (err: any) {
      setError(err.message || 'Failed to archive classroom')
    } finally {
      setIsProcessing(false)
      setPendingAction(null)
    }
  }

  async function restoreHotClassroom(classroom: Classroom) {
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
      invalidateTeacherClassrooms()
      setArchivedClassrooms((prev) => prev.filter((c) => c.id !== classroom.id))
      setActiveClassrooms((prev) => [updated, ...prev.filter((c) => c.id !== classroom.id)])
    } catch (err: any) {
      setError(err.message || 'Failed to restore classroom')
    } finally {
      setIsProcessing(false)
      setPendingAction(null)
    }
  }

  function openColdRestore(archive: ClassroomColdArchiveSummary) {
    if (!coldRestoreOperationIdsRef.current.has(archive.archive_id)) {
      coldRestoreOperationIdsRef.current.set(archive.archive_id, crypto.randomUUID())
    }
    setPendingAction({ mode: 'restore-cold', archive })
  }

  async function restoreColdArchive(archive: ClassroomColdArchiveSummary) {
    const operationId = coldRestoreOperationIdsRef.current.get(archive.archive_id)
    if (!operationId) return

    setIsProcessing(true)
    setError('')
    try {
      const res = await fetch(
        `/api/teacher/classrooms/${archive.classroom_id}/archives/${archive.archive_id}/restore`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': operationId },
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to restore stored classroom')
      }
      invalidateTeacherClassrooms()
      const refreshed = await loadArchived()
      if (refreshed) {
        coldRestoreOperationIdsRef.current.delete(archive.archive_id)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to restore stored classroom')
    } finally {
      setIsProcessing(false)
      setPendingAction(null)
    }
  }

  async function prepareArchivedClassroomAgain(classroom: Classroom) {
    let operationId = reuseOperationIdsRef.current.get(classroom.id)
    if (!operationId) {
      operationId = crypto.randomUUID()
      reuseOperationIdsRef.current.set(classroom.id, operationId)
    }

    setReusingClassroomId(classroom.id)
    setError('')
    try {
      const response = await fetch(
        `/api/teacher/classrooms/${classroom.id}/use-again`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': operationId },
        },
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to prepare this course')
      }
      if (data.status === 'review_required') {
        setReuseReview({
          classroomTitle: classroom.title,
          reviewUrl: data.review_url,
        })
        return
      }
      if (data.status !== 'ready' || typeof data.blueprint_id !== 'string') {
        throw new Error('Failed to prepare this course')
      }

      reuseOperationIdsRef.current.delete(classroom.id)
      invalidateTeacherBlueprints()
      setReuseBlueprintId(data.blueprint_id)
      setShowCreate(true)
    } catch (err: any) {
      setError(err.message || 'Failed to prepare this course')
    } finally {
      setReusingClassroomId(null)
    }
  }

  async function handleConfirmAction() {
    if (!pendingAction) return

    if (pendingAction.mode === 'archive') {
      await archiveClassroom(pendingAction.classroom)
      return
    }

    if (pendingAction.mode === 'restore-hot') {
      await restoreHotClassroom(pendingAction.classroom)
      return
    }

    if (pendingAction.mode === 'restore-cold') {
      await restoreColdArchive(pendingAction.archive)
    }
  }

  const dialogTitle = pendingAction
    ? pendingAction.mode === 'archive'
      ? `Archive ${pendingAction.classroom.title}?`
      : pendingAction.mode === 'restore-hot'
        ? `Unarchive ${pendingAction.classroom.title}?`
        : `Restore ${pendingAction.archive.title}?`
    : ''

  const dialogDescription = pendingAction
    ? pendingAction.mode === 'archive'
      ? 'Students will lose access until the classroom is unarchived.'
      : pendingAction.mode === 'restore-hot'
        ? 'Students will regain access to this classroom.'
        : 'The classroom will return to Archived with its submissions and files available.'
    : undefined

  const dialogConfirmLabel = pendingAction
    ? pendingAction.mode === 'archive'
      ? 'Archive'
      : pendingAction.mode === 'restore-hot'
        ? 'Unarchive'
        : 'Restore'
    : 'Confirm'

  const showCreateClassroomButton = view === 'active' && (activeClassrooms.length === 0 || isEditingClassrooms)

  const openClassroom = useCallback((classroom: Classroom) => {
    setOpeningClassroomId(classroom.id)
    router.push(`/classrooms/${classroom.id}?tab=attendance`)
  }, [router])

  return (
    <PageLayout density="teacher" width="reading">
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
        ) : (view === 'active' ? visibleClassrooms.length === 0 : !hasArchivedItems) ? (
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
                Archived classrooms will appear here so you can unarchive them later.
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
              <>
                {sortedArchived.map((c) => {
                  const theme = getClassroomThemeDefinition(c.theme_color)
                  const dateRange = formatClassroomDateRange(c.start_date, c.end_date)
                  return (
                    <div
                      key={c.id}
                      data-classroom-theme-color={theme.value}
                      style={getClassroomThemeStyle(theme.value)}
                      className="classroom-theme classroom-theme-card classroom-theme-card-interactive flex flex-col gap-3 overflow-hidden rounded-card border border-border bg-surface px-5 py-4 shadow-elevated lg:grid lg:grid-cols-[minmax(0,1fr),auto] lg:items-center lg:gap-5"
                    >
                      <button
                        type="button"
                        data-testid="classroom-card"
                        onClick={() => openClassroom(c)}
                        disabled={openingClassroomId !== null}
                        aria-busy={openingClassroomId === c.id}
                        className={[
                          '-m-1.5 min-w-0 rounded-control p-1.5 text-left',
                          openingClassroomId === c.id ? 'cursor-wait' : '',
                        ].join(' ')}
                      >
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <div className="min-w-0 truncate text-base font-semibold text-text-default">{c.title}</div>
                          {c.term_label && (
                            <div className="text-sm text-text-muted">{c.term_label}</div>
                          )}
                        </div>
                        <div className="mt-1 text-sm text-text-muted">
                          {dateRange ?? 'Semester dates not set'}
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
                          variant="primary"
                          size="xs"
                          onClick={() => prepareArchivedClassroomAgain(c)}
                          loading={reusingClassroomId === c.id}
                          disabled={
                            openingClassroomId !== null
                            || (reusingClassroomId !== null && reusingClassroomId !== c.id)
                          }
                        >
                          {reusingClassroomId === c.id ? 'Preparing' : 'Reuse'}
                        </Button>
                        <Button
                          type="button"
                          variant="surface"
                          size="xs"
                          onClick={() => setPendingAction({ mode: 'restore-hot', classroom: c })}
                          disabled={openingClassroomId !== null || reusingClassroomId !== null}
                        >
                          Unarchive
                        </Button>
                        {hotClassroomPurgeEnabledIds.has(c.id) ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="text-danger hover:text-danger"
                            aria-label="Delete permanently"
                            title="Delete permanently"
                            onClick={() => setPurgeClassroom(c)}
                            disabled={openingClassroomId !== null || reusingClassroomId !== null}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
                {coldArchives.map((archive) => (
                  <ColdClassroomArchiveRow
                    key={archive.archive_id}
                    archive={archive}
                    restoreEnabled={coldArchiveRestoreEnabled}
                    purgeEnabled={coldClassroomPurgeEnabledIds.has(archive.classroom_id)}
                    disabled={
                      isProcessing
                      || openingClassroomId !== null
                      || coldPurgeArchive !== null
                    }
                    onRestore={() => openColdRestore(archive)}
                    onDelete={() => setColdPurgeArchive(archive)}
                  />
                ))}
              </>
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

      <FloatingActionCluster
        placement="bottom"
        chrome="none"
        data-testid="classroom-bottom-controls"
      >
        <div className="relative min-h-[52px]">
          {isEditingClassrooms ? (
            <div className="absolute left-1/2 -translate-x-1/2">
              <SegmentedControl<ViewMode>
                ariaLabel="Classroom view"
                value={view}
                onChange={setView}
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
            </div>
          ) : null}
          <TeacherEditModeControls
            active={isEditingClassrooms}
            onActiveChange={(active) => {
              setIsEditingClassrooms(active)
              if (!active) {
                setDraggingClassroomId(null)
                setView('active')
              }
            }}
            disabled={openingClassroomId !== null}
            editLabel="Organize classrooms"
            activeTooltip="Hide organize actions"
            inactiveTooltip="Organize classrooms"
            className="absolute right-0 top-1/2 -translate-y-1/2"
          />
        </div>
      </FloatingActionCluster>

      <CreateClassroomModal
        isOpen={showCreate}
        initialBlueprintId={reuseBlueprintId}
        onClose={() => {
          setShowCreate(false)
          setReuseBlueprintId(null)
        }}
        onSuccess={(created) => {
          setShowCreate(false)
          setReuseBlueprintId(null)
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
        isConfirmDisabled={isProcessing}
        isCancelDisabled={isProcessing}
        onCancel={() => (isProcessing ? null : setPendingAction(null))}
        onConfirm={handleConfirmAction}
      />

      <ConfirmDialog
        isOpen={reuseReview !== null}
        title={`Review changes to ${reuseReview?.classroomTitle || 'this course'}?`}
        description="Both versions changed. Review which course changes to keep."
        confirmLabel="Review changes"
        cancelLabel="Cancel"
        onCancel={() => setReuseReview(null)}
        onConfirm={() => {
          if (!reuseReview) return
          reuseOperationIdsRef.current.clear()
          router.push(reuseReview.reviewUrl)
          setReuseReview(null)
        }}
      />

      {purgeClassroom ? (
        <ClassroomPurgeDialog
          classroomId={purgeClassroom.id}
          classroomTitle={purgeClassroom.title}
          isOpen
          onClose={() => setPurgeClassroom(null)}
          onCompleted={() => {
            invalidateTeacherClassrooms()
            setArchivedClassrooms((previous) =>
              previous.filter((classroom) => classroom.id !== purgeClassroom.id),
            )
            setPurgeClassroom(null)
          }}
        />
      ) : null}

      {coldPurgeArchive ? (
        <ColdClassroomPurgeDialog
          classroomId={coldPurgeArchive.classroom_id}
          archiveId={coldPurgeArchive.archive_id}
          classroomTitle={coldPurgeArchive.title}
          isOpen
          onClose={() => setColdPurgeArchive(null)}
          onCompleted={() => {
            invalidateTeacherClassrooms()
            setColdArchives((previous) => previous.filter(
              (archive) => archive.classroom_id !== coldPurgeArchive.classroom_id,
            ))
            setColdPurgeArchive(null)
          }}
        />
      ) : null}
    </PageLayout>
  )
}
