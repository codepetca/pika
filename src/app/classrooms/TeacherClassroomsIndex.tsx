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
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CircleDot,
  CopyPlus,
  DatabaseBackup,
  LoaderCircle,
  GripVertical,
  MoreVertical,
  Plus,
  RotateCw,
  Settings,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import { ClassroomPurgeDialog } from '@/components/ClassroomPurgeDialog'
import { ColdClassroomPurgeDialog } from '@/components/ColdClassroomPurgeDialog'
import { ColdClassroomArchiveRow } from '@/components/ColdClassroomArchiveRow'
import { TeacherWorkSurfaceIconMenuButton, type TeacherWorkSurfaceActionItem } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { Button, IconButton, ConfirmDialog, PageActionBar, PageContent, PageHeading, PageLayout, PageState } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { ClassroomRowGhost, SortableClassroomRow } from '@/components/SortableClassroomRow'
import type { Classroom } from '@/types'
import type {
  ClassroomColdArchiveSummary,
  ClassroomHotArchiveRecoverySummary,
} from '@/lib/contracts/classroom-lifecycle'
import {
  fetchTeacherArchivedClassroomState,
  fetchTeacherClassrooms,
  invalidateTeacherClassrooms,
} from '@/lib/teacher-classrooms-client'
import { invalidateTeacherBlueprints } from '@/lib/teacher-blueprints-client'
import { formatClassroomDateRange } from '@/lib/classroom-date-range'
import { getClassroomThemeDefinition, getClassroomThemeStyle } from '@/lib/classroom-theme'
import { classroomArchiveOperationId } from '@/lib/classroom-archive-operation-id'
import { APP_HOME_SELECTED_EVENT } from '@/lib/events'

interface Props {
  initialClassrooms: Classroom[]
}

type ViewMode = 'active' | 'archived'

type PendingAction =
  | { mode: 'archive'; classroom: Classroom }
  | {
      mode: 'export-hot'
      classroom: Classroom
      recovery: ClassroomHotArchiveRecoverySummary
    }
  | { mode: 'restore-hot'; classroom: Classroom }
  | { mode: 'restore-cold'; archive: ClassroomColdArchiveSummary }
  | null

type ReuseReview = {
  classroomTitle: string
  reviewUrl: string
} | null

function formatArchiveSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function hotArchiveRecoveryActionLabel(
  recovery: ClassroomHotArchiveRecoverySummary | undefined,
): string {
  if (recovery?.latest_operation?.status === 'snapshot_ready') return 'Resume recovery copy'
  if (
    recovery?.latest_operation?.status === 'failed'
    && recovery.latest_operation.retryable
  ) return 'Retry recovery copy'
  return 'Create recovery copy'
}

function isResumableHotArchiveOperation(
  recovery: ClassroomHotArchiveRecoverySummary | undefined,
): boolean {
  const operation = recovery?.latest_operation
  if (!operation) return false
  if (
    recovery.current_revision === null
    || operation.source_revision !== recovery.current_revision
  ) return false
  const canRetry = operation.status === 'snapshot_ready'
    || (operation.status === 'failed' && operation.retryable)
  if (!canRetry) return false
  return operation.retention.mode === 'teacher_managed'
    || Date.parse(operation.retention.delete_after) > Date.now()
}

export function TeacherClassroomsIndex({ initialClassrooms }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const lastPathRef = useRef(pathname)
  const classroomsRef = useRef<HTMLDivElement>(null)
  const listHeadingRef = useRef<HTMLHeadingElement>(null)
  const coldRestoreOperationIdsRef = useRef(new Map<string, string>())
  const hotArchiveOperationIdsRef = useRef(new Map<
    string,
    { operationId: string; sourceRevision: number }
  >())
  const reuseOperationIdsRef = useRef(new Map<string, string>())
  const [activeClassrooms, setActiveClassrooms] = useState<Classroom[]>(initialClassrooms)
  const [archivedClassrooms, setArchivedClassrooms] = useState<Classroom[]>([])
  const [coldArchives, setColdArchives] = useState<ClassroomColdArchiveSummary[]>([])
  const [coldArchiveRestoreEnabled, setColdArchiveRestoreEnabled] = useState(false)
  const [hotArchiveRecovery, setHotArchiveRecovery] = useState<ClassroomHotArchiveRecoverySummary[]>([])
  const [hotArchiveRecoveryStatusAvailable, setHotArchiveRecoveryStatusAvailable] = useState(true)
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
  const [archiveLoadError, setArchiveLoadError] = useState('')
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
  const visibleError = error || (view === 'archived' ? archiveLoadError : '')
  const hotArchiveRecoveryByClassroom = useMemo(
    () => new Map(hotArchiveRecovery.map((recovery) => [recovery.classroom_id, recovery])),
    [hotArchiveRecovery],
  )
  const draggingClassroom = useMemo(
    () => activeClassrooms.find((classroom) => classroom.id === draggingClassroomId) ?? null,
    [activeClassrooms, draggingClassroomId]
  )

  const loadArchived = useCallback(async () => {
    setIsLoadingArchived(true)
    setArchiveLoadError('')
    setError('')
    try {
      const state = await fetchTeacherArchivedClassroomState()
      setArchivedClassrooms(state.classrooms)
      setColdArchives(state.coldArchives)
      setColdArchiveRestoreEnabled(state.coldArchiveRestoreEnabled)
      setHotArchiveRecovery(state.hotArchiveRecovery ?? [])
      setHotArchiveRecoveryStatusAvailable(state.hotArchiveRecoveryStatusAvailable ?? true)
      for (const recovery of state.hotArchiveRecovery ?? []) {
        const retainedOperation = hotArchiveOperationIdsRef.current.get(recovery.classroom_id)
        if (
          recovery.current_revision !== null && (
            retainedOperation?.sourceRevision !== recovery.current_revision
            || recovery.latest_archive?.source_revision === recovery.current_revision
          )
        ) {
          hotArchiveOperationIdsRef.current.delete(recovery.classroom_id)
        }
      }
      setHotClassroomPurgeEnabledIds(new Set(state.hotClassroomPurgeEnabledIds ?? []))
      setColdClassroomPurgeEnabledIds(new Set(state.coldClassroomPurgeEnabledIds ?? []))
      return state
    } catch (err: any) {
      setArchiveLoadError(err.message || 'Failed to load archived classrooms')
      return null
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

  const resetClassroomView = useCallback(() => {
    setDraggingClassroomId(null)
    setView('active')
    setIsEditingClassrooms(false)
    setError('')
  }, [])

  const returnToActiveList = useCallback(() => {
    resetClassroomView()
    window.requestAnimationFrame(() => listHeadingRef.current?.focus())
  }, [resetClassroomView])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (view === 'active' && !isEditingClassrooms) return
      // Nested menus, dialogs, and active drag gestures own their Escape key.
      if (draggingClassroomId || document.querySelector('[aria-modal="true"]')) return
      if (classroomsRef.current?.querySelector('[aria-haspopup="menu"][aria-expanded="true"]')) return
      if (!classroomsRef.current?.contains(document.activeElement)) return
      returnToActiveList()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [draggingClassroomId, isEditingClassrooms, returnToActiveList, view])

  useEffect(() => {
    window.addEventListener('pageshow', resetClassroomView)
    window.addEventListener(APP_HOME_SELECTED_EVENT, returnToActiveList)
    return () => {
      window.removeEventListener('pageshow', resetClassroomView)
      window.removeEventListener(APP_HOME_SELECTED_EVENT, returnToActiveList)
    }
  }, [resetClassroomView, returnToActiveList])

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

  async function openHotArchiveExport(
    classroom: Classroom,
    recovery: ClassroomHotArchiveRecoverySummary,
  ) {
    const resumableOperation = recovery?.latest_operation
    if (resumableOperation && isResumableHotArchiveOperation(recovery)) {
      hotArchiveOperationIdsRef.current.set(classroom.id, {
        operationId: resumableOperation.operation_id,
        sourceRevision: resumableOperation.source_revision,
      })
    } else if (
      recovery.current_revision !== null
      && !hotArchiveOperationIdsRef.current.has(classroom.id)
    ) {
      hotArchiveOperationIdsRef.current.set(classroom.id, {
        operationId: await classroomArchiveOperationId({
          classroomId: classroom.id,
          archivedAt: classroom.archived_at || classroom.updated_at,
        }),
        sourceRevision: recovery.current_revision,
      })
    }
    setPendingAction({ mode: 'export-hot', classroom, recovery })
  }

  async function exportHotArchive(
    classroom: Classroom,
    recovery: ClassroomHotArchiveRecoverySummary,
  ) {
    const retainedOperation = hotArchiveOperationIdsRef.current.get(classroom.id)
    if (!retainedOperation) return
    const expectedSourceRevision = recovery.current_revision
    if (expectedSourceRevision === null) {
      setError('Recovery-copy status must be refreshed before creating a copy')
      return
    }
    if (retainedOperation.sourceRevision !== expectedSourceRevision) {
      hotArchiveOperationIdsRef.current.delete(classroom.id)
      setError('Recovery-copy status changed; create the copy again')
      return
    }
    const operationId = retainedOperation.operationId
    const retention = isResumableHotArchiveOperation(recovery)
      ? recovery.latest_operation!.retention
      : { mode: 'teacher_managed' as const, delete_after: null }

    setIsProcessing(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/classrooms/${classroom.id}/archives`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': operationId,
        },
        body: JSON.stringify({
          retention,
          expected_source_revision: expectedSourceRevision,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data.error_code === 'classroom_archive_source_revision_changed') {
          hotArchiveOperationIdsRef.current.delete(classroom.id)
          invalidateTeacherClassrooms()
          await loadArchived()
        }
        if (data.retryable === false) {
          hotArchiveOperationIdsRef.current.delete(classroom.id)
        }
        throw new Error(data.error || 'Failed to create recovery copy')
      }

      invalidateTeacherClassrooms()
      const refreshed = await loadArchived()
      const refreshedRecovery = refreshed?.hotArchiveRecovery?.find(
        (entry) => entry.classroom_id === classroom.id,
      )
      if (
        refreshed?.hotArchiveRecoveryStatusAvailable !== false
        && refreshedRecovery
        && refreshedRecovery.current_revision !== null
        && refreshedRecovery.latest_archive?.source_revision === refreshedRecovery.current_revision
      ) {
        hotArchiveOperationIdsRef.current.delete(classroom.id)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create recovery copy')
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

    if (pendingAction.mode === 'export-hot') {
      await exportHotArchive(pendingAction.classroom, pendingAction.recovery)
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
      : pendingAction.mode === 'export-hot'
        ? `Create a recovery copy of ${pendingAction.classroom.title}?`
      : pendingAction.mode === 'restore-hot'
        ? `Unarchive ${pendingAction.classroom.title}?`
        : `Restore ${pendingAction.archive.title}?`
    : ''

  const dialogDescription = pendingAction
    ? pendingAction.mode === 'archive'
      ? 'Students will lose access until the classroom is unarchived.'
      : pendingAction.mode === 'export-hot'
        ? 'Creates a private, verified recovery copy in Supabase Storage. The classroom remains archived in the database and no classroom data is removed.'
      : pendingAction.mode === 'restore-hot'
        ? 'Students will regain access to this classroom.'
        : 'The classroom will return to Archived with its submissions and files available.'
    : undefined

  const dialogConfirmLabel = pendingAction
    ? pendingAction.mode === 'archive'
      ? 'Archive'
      : pendingAction.mode === 'export-hot'
        ? 'Create recovery copy'
      : pendingAction.mode === 'restore-hot'
        ? 'Unarchive'
        : 'Restore'
    : 'Confirm'

  const classroomActions: TeacherWorkSurfaceActionItem[] = [
    {
      id: 'create',
      label: 'New Classroom',
      icon: <Plus className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => setShowCreate(true),
    },
    {
      id: 'edit',
      label: 'Edit classrooms',
      icon: <GripVertical className="h-4 w-4" aria-hidden="true" />,
      checked: isEditingClassrooms,
      checkedRole: 'menuitemcheckbox',
      onSelect: () => {
        setDraggingClassroomId(null)
        setView('active')
        setError('')
        setIsEditingClassrooms((current) => !current)
      },
    },
    {
      id: 'toggle-archive-view',
      label: view === 'active' ? 'Show Archived' : 'Show Active',
      icon: view === 'active'
        ? <Archive className="h-4 w-4" aria-hidden="true" />
        : <CircleDot className="h-4 w-4" aria-hidden="true" />,
      dividerBefore: true,
      onSelect: () => {
        setDraggingClassroomId(null)
        setView((current) => current === 'active' ? 'archived' : 'active')
        setError('')
        setIsEditingClassrooms(false)
      },
    },
  ]

  const openClassroom = useCallback((classroom: Classroom, options?: { reviewClassDays?: boolean }) => {
    setOpeningClassroomId(classroom.id)
    const params = new URLSearchParams({ tab: 'daily' })
    if (options?.reviewClassDays) params.set('reviewClassDays', '1')
    router.push(`/classrooms/${classroom.id}?${params.toString()}`)
  }, [router])

  return (
    <PageLayout density="teacher" width="reading">
      <div ref={classroomsRef}>
        <div className="pt-density-compact-content-top" data-testid="classroom-top-controls">
          {isEditingClassrooms || view === 'archived' ? (
            <div className="px-density-compact-gutter">
              <Button type="button" variant="ghost" size="xs" className="-ml-2 mb-1 px-2 text-text-muted" onClick={returnToActiveList} disabled={openingClassroomId !== null}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to classrooms
              </Button>
            </div>
          ) : null}
          <PageActionBar
            primary={
              <PageHeading
                title={view === 'active' ? 'Active classrooms' : 'Archived classrooms'}
                size="section"
                headingRef={listHeadingRef}
                tabIndex={-1}
              />
            }
            trailing={
              <>
                {isEditingClassrooms ? <span className="text-xs font-medium text-primary">Editing</span> : null}
                <TeacherWorkSurfaceIconMenuButton
                  ariaLabel="Classroom actions"
                  menuAriaLabel="Classroom actions"
                  tooltip="Classroom actions"
                  icon={<MoreVertical className="h-5 w-5" aria-hidden="true" />}
                  items={classroomActions}
                  variant="ghost"
                  menuPlacement="down"
                  menuAlign="end"
                  menuClassName="w-64"
                  disabled={openingClassroomId !== null}
                />
              </>
            }
          />
        </div>
        <PageContent>
          {visibleError && !(view === 'archived' && archiveLoadError && !hasArchivedItems) && (
            <div role="alert" className="mb-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
              {visibleError}
            </div>
          )}

          {view === 'active' && visibleClassrooms.length > 1 && isReordering && (
            <p className="mb-3 text-sm text-text-muted">Saving…</p>
          )}

          {view === 'archived' && isLoadingArchived ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : view === 'archived' && archiveLoadError && !hasArchivedItems ? (
            <PageState
              kind="error"
              title="Could not load archived classrooms"
              description={archiveLoadError}
              action={<IconButton icon={RotateCw} label="Try loading archived classrooms again" variant="secondary" onClick={() => void loadArchived()} />}
            />
          ) : (view === 'active' ? visibleClassrooms.length === 0 : !hasArchivedItems) ? (
            view === 'active' ? (
              /* Empty active: center the CTA on screen */
              <div className="flex flex-col items-center justify-center" style={{ minHeight: 'calc(100dvh - 12rem)' }}>
                <p className="text-sm text-text-muted">Create your first classroom</p>
                <IconButton
                  type="button"
                  variant="primary"
                  size="sm"
                  className="mt-4"
                  onClick={() => setShowCreate(true)}
                  icon={Plus}
                  label="Create classroom"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-sm font-medium text-text-default">No archived classrooms</p>
                <p className="mt-1 text-sm text-text-muted">
                  Archived classrooms will appear here so you can unarchive them later.
                </p>
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
                  {!hotArchiveRecoveryStatusAvailable ? (
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-text-default">
                      <span>Recovery-copy status is temporarily unavailable.</span>
                      <Button
                        type="button"
                        variant="surface"
                        size="xs"
                        onClick={() => void loadArchived()}
                        disabled={isLoadingArchived}
                      >
                        Retry status
                      </Button>
                    </div>
                  ) : null}
                  {sortedArchived.map((c) => {
                    const theme = getClassroomThemeDefinition(c.theme_color)
                    const dateRange = formatClassroomDateRange(c.start_date, c.end_date)
                    const recovery = hotArchiveRecoveryByClassroom.get(c.id)
                    const latestArchive = recovery?.latest_archive
                    const verifiedArchive = latestArchive?.source_revision === recovery?.current_revision
                      ? latestArchive
                      : null
                    const staleArchive = latestArchive && !verifiedArchive ? latestArchive : null
                    const latestOperation = recovery?.latest_operation
                    const hasRetryableOperation = isResumableHotArchiveOperation(recovery)
                    const exportCanStart = recovery?.export_available
                      && !(latestOperation?.status === 'failed' && latestOperation.retryable === false)
                    return (
                      <div
                        key={c.id}
                        data-classroom-theme-color={theme.value}
                        style={getClassroomThemeStyle(theme.value)}
                        className="classroom-theme classroom-theme-card classroom-theme-card-interactive relative flex items-start gap-3 focus-within:z-local-menu rounded-card border border-border bg-surface px-5 py-4 shadow-elevated lg:grid lg:grid-cols-[minmax(0,1fr),auto] lg:items-center lg:gap-5"
                      >
                        <div className="min-w-0 flex-1 space-y-2">
                          <button
                            type="button"
                            data-testid="classroom-card"
                            onClick={() => openClassroom(c)}
                            disabled={openingClassroomId !== null}
                            aria-busy={openingClassroomId === c.id}
                            className={[
                              '-m-1.5 block w-full min-w-0 rounded-control p-1.5 text-left',
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
                            {verifiedArchive ? (
                              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                                <span className="inline-flex items-center gap-1 font-medium text-success">
                                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                                  Recovery copy verified
                                </span>
                                <span aria-hidden="true">&middot;</span>
                                <span>{formatArchiveSize(verifiedArchive.compressed_byte_size)}</span>
                                <span aria-hidden="true">&middot;</span>
                                <span>
                                  {verifiedArchive.retention.mode === 'teacher_managed'
                                    ? 'Kept until you delete it'
                                    : `Retention date ${new Intl.DateTimeFormat('en-CA', {
                                        timeZone: 'America/Toronto',
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric',
                                      }).format(new Date(verifiedArchive.retention.delete_after))}`}
                                </span>
                              </div>
                            ) : staleArchive ? (
                              <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-warning">
                                <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                                Recovery copy out of date
                              </div>
                            ) : latestOperation?.status === 'failed' ? (
                              <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-danger">
                                <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                                Recovery copy needs attention
                              </div>
                            ) : (
                              <div className="mt-2 inline-flex items-center gap-1 text-xs text-text-muted">
                                <DatabaseBackup className="h-3.5 w-3.5" aria-hidden="true" />
                                {latestOperation?.status === 'snapshot_ready'
                                  ? 'Recovery copy interrupted'
                                  : recovery && !recovery.export_available
                                    ? 'Database archive only · Recovery copy unavailable'
                                    : 'Database archive only'}
                              </div>
                            )}
                            {openingClassroomId === c.id && (
                              <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                Opening classroom...
                              </div>
                            )}
                          </button>
                          {!verifiedArchive && recovery && exportCanStart ? (
                            <Button
                              type="button"
                              variant="surface"
                              size="xs"
                              onClick={() => void openHotArchiveExport(c, recovery)}
                              disabled={openingClassroomId !== null || reusingClassroomId !== null || isProcessing}
                            >
                              <DatabaseBackup className="h-3.5 w-3.5" aria-hidden="true" />
                              {hasRetryableOperation
                                ? hotArchiveRecoveryActionLabel(recovery)
                                : 'Create recovery copy'}
                            </Button>
                          ) : null}
                        </div>
                        <div className="shrink-0 self-start lg:self-center">
                          <TeacherWorkSurfaceIconMenuButton
                            ariaLabel={`Settings for ${c.title}`}
                            tooltip="Settings"
                            icon={reusingClassroomId === c.id
                              ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                              : <Settings className="h-5 w-5" aria-hidden="true" />}
                            disabled={openingClassroomId !== null || reusingClassroomId !== null}
                            buttonProps={{ 'aria-busy': reusingClassroomId === c.id || undefined }}
                            items={[
                              {
                                id: 'reuse',
                                label: 'Reuse',
                                icon: <CopyPlus className="h-4 w-4" aria-hidden="true" />,
                                onSelect: () => void prepareArchivedClassroomAgain(c),
                              },
                              {
                                id: 'unarchive',
                                label: 'Unarchive',
                                icon: <ArchiveRestore className="h-4 w-4" aria-hidden="true" />,
                                onSelect: () => setPendingAction({ mode: 'restore-hot', classroom: c }),
                              },
                              {
                                id: 'delete',
                                label: 'Delete',
                                icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
                                destructive: true,
                                disabled: !hotClassroomPurgeEnabledIds.has(c.id),
                                onSelect: () => setPurgeClassroom(c),
                              },
                            ]}
                          />
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

        </PageContent>

      </div>

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
          setActiveClassrooms((prev) => [created, ...prev.filter((item) => item.id !== created.id)])
          openClassroom(created, { reviewClassDays: true })
        }}
        onBlueprintCreated={(created) => {
          setActiveClassrooms((prev) => [created, ...prev.filter((item) => item.id !== created.id)])
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
