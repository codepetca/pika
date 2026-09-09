'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Classroom, GradebookAssessmentColumn, GradebookCategory, GradebookStudentSummary } from '@/types'
import { Button, ConfirmDialog, PageState, RefreshingIndicator, useAppMessage } from '@/ui'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import { TeacherWorkspaceSplit } from '@/components/teacher-work-surface/TeacherWorkspaceSplit'
import { GradebookAssessmentDialog, GradebookEditorDialog } from '@/components/gradebook/GradebookDialogs'
import { GradebookStudentPanel } from '@/components/gradebook/GradebookStudentPanel'
import { GradebookTable } from '@/components/gradebook/GradebookTable'
import { GradebookScoreDialog } from '@/components/gradebook/GradebookScoreDialog'
import { GradebookToolbar, type GradebookDisplayPreferences } from '@/components/gradebook/GradebookToolbar'
import { fetchJSONWithCache, invalidateCachedJSONMatching } from '@/lib/request-cache'
import { safeLocalGetJson, safeLocalSetJson } from '@/lib/client-storage'
import { applyDirection, compareByNameFields, toggleSort } from '@/lib/table-sort'
import { average, formatCompactPercent, getAssessmentCell, getStudentDisplayId, getStudentName, getValidEmailList, getAssessmentColumnKey, median, type GradebookIdentityColumn } from '@/lib/gradebook-display'
import { DEFAULT_GRADEBOOK_PREFERENCES as DEFAULT_PREFERENCES, normalizeGradebookPreferences, downloadGradebookCsv } from '@/lib/gradebook-editor'
import { saveGradebookAssessment } from '@/lib/gradebook-save'
import { getGradebookEmail2Addresses } from '@/lib/gradebook-email'
import { useGradebookEmail2 } from '@/hooks/useGradebookEmail2'
import { useTableColumnWidths } from '@/hooks/useTableColumnWidths'
import { useTableSelection } from '@/hooks/useTableSelection'
import { useScrollPositionMemory } from '@/hooks/useScrollPositionMemory'

type GradebookSection = 'grades' | 'settings'
type GradebookSortColumn = GradebookIdentityColumn
interface Props { classroom: Classroom; isActive?: boolean; sectionParam?: string | null; onSectionChange?: (section: GradebookSection) => void }
interface GradebookPayload { assessment_columns?: GradebookAssessmentColumn[]; categories?: GradebookCategory[]; category_schema_available?: boolean; score_overrides_available?: boolean; students: GradebookStudentSummary[] }
type GradebookScoreEditTarget =
  | { kind: 'assessment'; student: GradebookStudentSummary; column: GradebookAssessmentColumn }
  | { kind: 'final'; student: GradebookStudentSummary }
const PREFERENCES_KEY = 'teacher-gradebook:display:v1'
const ASSESSMENT_WEIGHT_MIN = 1
const ASSESSMENT_WEIGHT_DEFAULT = 10
const ASSESSMENT_WEIGHT_MAX = 999
const GRADEBOOK_COLUMN_LIMITS = {
  first_name: { defaultWidth: 96, min: 72, max: 220 },
  last_name: { defaultWidth: 96, min: 72, max: 220 },
  id: { defaultWidth: 80, min: 64, max: 180 },
  final: { defaultWidth: 80, min: 80, max: 220 },
}

export function TeacherGradebookTab({
  classroom,
  isActive = true,
  sectionParam,
  onSectionChange = () => {},
}: Props) {
  const isReadOnly = !!classroom.archived_at
  const { showMessage } = useAppMessage()
  const email2 = useGradebookEmail2(classroom.id, isActive)
  const [loading, setLoading] = useState(true)
  const [isRetrying, setIsRetrying] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [loadedClassroomId, setLoadedClassroomId] = useState<string | null>(null)
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES)
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)
  const { scoreDisplayMode } = preferences
  const [categorySchemaAvailable, setCategorySchemaAvailable] = useState(true)
  const [scoreOverridesAvailable, setScoreOverridesAvailable] = useState(true)
  useEffect(() => {
    const saved = safeLocalGetJson<Partial<GradebookDisplayPreferences>>(PREFERENCES_KEY)
    if (saved) setPreferences(normalizeGradebookPreferences(saved))
    setPreferencesLoaded(true)
  }, [])
  useEffect(() => {
    if (preferencesLoaded) safeLocalSetJson(PREFERENCES_KEY, preferences)
  }, [preferences, preferencesLoaded])
  function updatePreferences(changes: Partial<GradebookDisplayPreferences>) {
    setPreferences((current) => ({ ...current, ...changes }))
  }
  const { columnWidths, setColumnWidth } = useTableColumnWidths({
    storageKey: 'teacher-gradebook:v1',
    columns: GRADEBOOK_COLUMN_LIMITS,
  })
  const [assessmentWeightDrafts, setAssessmentWeightDrafts] = useState<Record<string, string>>({})
  const [savingAssessmentKeys, setSavingAssessmentKeys] = useState<Set<string>>(() => new Set())
  const [assessmentColumns, setAssessmentColumns] = useState<GradebookAssessmentColumn[]>([])
  const [categories, setCategories] = useState<GradebookCategory[]>([])
  const [gradebookEditorOpen, setGradebookEditorOpen] = useState(false)
  const [selectedAssessment, setSelectedAssessment] = useState<GradebookAssessmentColumn | null>(null)
  const [scoreEditTarget, setScoreEditTarget] = useState<GradebookScoreEditTarget | null>(null)
  const [savingScoreKeys, setSavingScoreKeys] = useState<Set<string>>(() => new Set())
  const [scoreDialogError, setScoreDialogError] = useState('')
  const [undoAllOpen, setUndoAllOpen] = useState(false)
  const [undoAllSaving, setUndoAllSaving] = useState(false)
  const [dialogSaving, setDialogSaving] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [students, setStudents] = useState<GradebookStudentSummary[]>([])
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [detailPaneWidth, setDetailPaneWidth] = useState(32)
  const loadRequestIdRef = useRef(0)
  const assessmentSaveChainsRef = useRef<Map<string, Promise<void>>>(new Map())
  const dirtyWeightsRef = useRef(new Map<string, string>())
  const settingsLinkHandledRef = useRef(false)
  const wasActiveRef = useRef(isActive)
  const dialogSaveSequenceRef = useRef(0)
  const scoreMutationSequenceRef = useRef(0)
  const currentClassroomIdRef = useRef<string | null>(null)
  const retryFocusIntentRef = useRef(false)
  const [{ column: sortColumn, direction: sortDirection }, setSortState] = useState<{
    column: GradebookSortColumn
    direction: 'asc' | 'desc'
  }>({ column: 'last_name', direction: 'asc' })

  useLayoutEffect(() => {
    const committedClassroomId = classroom.id
    currentClassroomIdRef.current = committedClassroomId
    return () => {
      if (currentClassroomIdRef.current === committedClassroomId) {
        currentClassroomIdRef.current = null
      }
    }
  }, [classroom.id])

  const hasCurrentSnapshot = loadedClassroomId === classroom.id

  const sortedStudents = useMemo(() => {
    const rows = [...students]
    rows.sort((a, b) => {
      if (sortColumn === 'id') {
        const cmp = getStudentDisplayId(a).localeCompare(getStudentDisplayId(b))
        if (cmp !== 0) return applyDirection(cmp, sortDirection)
        return compareByNameFields(
          { firstName: a.student_first_name, lastName: a.student_last_name, id: a.student_email },
          { firstName: b.student_first_name, lastName: b.student_last_name, id: b.student_email },
          'last_name',
          'asc',
        )
      }

      return compareByNameFields(
        { firstName: a.student_first_name, lastName: a.student_last_name, id: a.student_email },
        { firstName: b.student_first_name, lastName: b.student_last_name, id: b.student_email },
        sortColumn,
        sortDirection,
      )
    })
    return rows
  }, [students, sortColumn, sortDirection])

  const selectedStudent = useMemo(
    () => students.find((student) => student.student_id === selectedStudentId) || null,
    [selectedStudentId, students],
  )
  const mobileStudent = selectedStudent ?? sortedStudents[0] ?? null
  const finalValues = useMemo(
    () => students.map((student) => student.final_percent).filter((value): value is number => value != null),
    [students],
  )
  const classAverage = formatCompactPercent(average(finalValues))
  const classMedian = formatCompactPercent(median(finalValues))
  const rowKeys = useMemo(() => sortedStudents.map((student) => student.student_id), [sortedStudents])
  const {
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    allSelected,
    someSelected,
    clearSelection,
  } = useTableSelection(rowKeys)
  const selectedStudents = useMemo(
    () => sortedStudents.filter((student) => selectedIds.has(student.student_id)),
    [selectedIds, sortedStudents],
  )
  const selectedStudentEmails = useMemo(
    () => getValidEmailList(selectedStudents.map((student) => student.student_email)),
    [selectedStudents],
  )
  const {
    scrollRef: gradebookTableScrollRef,
    preserveScrollPosition: preserveGradebookTableScrollPosition,
  } = useScrollPositionMemory<HTMLDivElement>({
    key: `${classroom.id}:gradebook`,
    enabled: true,
    restoreToken: [
      selectedStudentId ?? 'none',
      sortedStudents.length,
      loading ? 'loading' : 'ready',
    ].join(':'),
  })

  function handleSort(column: GradebookSortColumn) {
    setSortState((previous) => toggleSort(previous, column))
  }

  const loadGradebook = useCallback(async (options?: {
    preserveSnapshot?: boolean
    isRetry?: boolean
  }) => {
    const classroomId = classroom.id
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    setLoading(true)
    setIsRetrying(options?.isRetry === true)
    if (!options?.isRetry) setLoadError('')
    try {
      const data = await fetchJSONWithCache<GradebookPayload>(
        `gradebook:${classroomId}:class`,
        async () => {
          const response = await fetch(`/api/teacher/gradebook?classroom_id=${classroomId}`)
          const json = await response.json()
          if (!response.ok) throw new Error(json.error || 'Failed to load gradebook')
          return json
        },
        60_000,
      )
      if (
        loadRequestIdRef.current !== requestId
        || currentClassroomIdRef.current !== classroomId
      ) return

      const columnsWithWeights = (data.assessment_columns || []).map((column) => ({
        ...column,
        weight: Number(column.weight || ASSESSMENT_WEIGHT_DEFAULT),
      }))
      setAssessmentColumns(columnsWithWeights)
      setCategories(data.categories || [])
      setCategorySchemaAvailable(data.category_schema_available !== false)
      setScoreOverridesAvailable(data.score_overrides_available !== false)
      setAssessmentWeightDrafts(() => {
        const next: Record<string, string> = {}
        for (const column of columnsWithWeights) {
          const key = getAssessmentColumnKey(column)
          next[key] = dirtyWeightsRef.current.get(key) ?? String(column.weight)
        }
        return next
      })
      setStudents(data.students || [])
      setLoadedClassroomId(classroomId)
      setLoadError('')
    } catch (err: unknown) {
      if (
        loadRequestIdRef.current !== requestId
        || currentClassroomIdRef.current !== classroomId
      ) return
      if (!options?.preserveSnapshot) {
        setAssessmentColumns([])
        setCategories([])
        setAssessmentWeightDrafts({})
        setStudents([])
        setLoadedClassroomId(null)
      }
      setLoadError(err instanceof Error ? err.message : 'Failed to load gradebook')
    } finally {
      if (
        loadRequestIdRef.current === requestId
        && currentClassroomIdRef.current === classroomId
      ) {
        setLoading(false)
        setIsRetrying(false)
      }
    }
  }, [classroom.id])

  useEffect(() => {
    loadRequestIdRef.current += 1
    dialogSaveSequenceRef.current += 1
    scoreMutationSequenceRef.current += 1
    assessmentSaveChainsRef.current = new Map()
    dirtyWeightsRef.current.clear()
    settingsLinkHandledRef.current = false
    setAssessmentColumns([])
    setCategories([])
    setAssessmentWeightDrafts({})
    setStudents([])
    setLoadedClassroomId(null)
    setLoadError('')
    setActionError('')
    setIsRetrying(false)
    setSavingAssessmentKeys(new Set())
    setGradebookEditorOpen(false)
    setSelectedAssessment(null)
    setScoreEditTarget(null)
    setSavingScoreKeys(new Set())
    setScoreDialogError('')
    setUndoAllOpen(false)
    setUndoAllSaving(false)
    setDialogSaving(false)
    setDialogError('')
    setSelectedStudentId(null)
    retryFocusIntentRef.current = false
    void loadGradebook()
    // The classroom transition owns the reset and initial request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroom.id])

  useEffect(() => {
    if (isActive && !wasActiveRef.current) {
      invalidateCachedJSONMatching(`gradebook:${classroom.id}:`)
      void loadGradebook({ preserveSnapshot: hasCurrentSnapshot })
    }
    wasActiveRef.current = isActive
  }, [classroom.id, isActive, hasCurrentSnapshot, loadGradebook])

  function retryGradebookLoad() {
    if (loading) return
    retryFocusIntentRef.current = true
    invalidateCachedJSONMatching(`gradebook:${classroom.id}:`)
    void loadGradebook({ preserveSnapshot: hasCurrentSnapshot, isRetry: true })
  }

  useEffect(() => {
    if (!loading && !loadError && hasCurrentSnapshot && retryFocusIntentRef.current) {
      retryFocusIntentRef.current = false
      gradebookTableScrollRef.current?.focus()
    }
  }, [gradebookTableScrollRef, hasCurrentSnapshot, loadError, loading])

  useEffect(() => {
    if (sectionParam !== 'settings') settingsLinkHandledRef.current = false
    if (sectionParam === 'settings' && hasCurrentSnapshot && !isReadOnly && categorySchemaAvailable && !settingsLinkHandledRef.current) {
      settingsLinkHandledRef.current = true
      setGradebookEditorOpen(true)
      onSectionChange('grades')
    }
  }, [sectionParam, hasCurrentSnapshot, isReadOnly, categorySchemaAvailable, onSectionChange])

  useEffect(() => {
    if (!selectedStudentId) return
    if (students.some((student) => student.student_id === selectedStudentId)) return
    setSelectedStudentId(null)
  }, [selectedStudentId, students])

  async function copySelectedEmailsToClipboard(emails = selectedStudentEmails, label = 'Student emails') {
    if (emails.length === 0) {
      showMessage({ text: `No ${label.toLowerCase()} for selected students`, tone: 'warning' })
      return
    }

    const text = emails.join(', ')
    setActionError('')
    try {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        const textarea = document.createElement('textarea')
        textarea.value = text
        document.body.appendChild(textarea)
        try {
          textarea.select()
          if (!document.execCommand('copy')) throw new Error('Clipboard unavailable')
        } finally {
          document.body.removeChild(textarea)
        }
      }
      showMessage({ text: `${label} copied`, tone: 'success' })
    } catch {
      setActionError(`Could not copy ${label.toLowerCase()}. Check browser clipboard permission and try again.`)
    }
  }

  function handleStudentSelect(student: GradebookStudentSummary) {
    preserveGradebookTableScrollPosition()
    setSelectedStudentId((previous) => (
      previous === student.student_id ? null : student.student_id
    ))
  }

  function handleAssessmentWeightDraftChange(column: GradebookAssessmentColumn, value: string) {
    const key = getAssessmentColumnKey(column)
    dirtyWeightsRef.current.set(key, value)
    setAssessmentWeightDrafts((previous) => ({ ...previous, [key]: value }))
  }

  async function handleAssessmentWeightCommit(column: GradebookAssessmentColumn) {
    if (isReadOnly) return

    const key = getAssessmentColumnKey(column)
    const rawValue = assessmentWeightDrafts[key] ?? String(column.weight)
    const nextWeight = Number(rawValue)

    if (
      !Number.isInteger(nextWeight) ||
      nextWeight < ASSESSMENT_WEIGHT_MIN ||
      nextWeight > ASSESSMENT_WEIGHT_MAX
    ) {
      dirtyWeightsRef.current.delete(key)
      setAssessmentWeightDrafts((previous) => ({ ...previous, [key]: String(column.weight) }))
      setActionError(`Assessment weight must be an integer ${ASSESSMENT_WEIGHT_MIN}-${ASSESSMENT_WEIGHT_MAX}`)
      return
    }

    if (nextWeight === column.weight) {
      dirtyWeightsRef.current.delete(key)
      return
    }

    const classroomId = classroom.id
    setSavingAssessmentKeys((previous) => new Set(previous).add(key))
    setActionError('')
    const previousSave = assessmentSaveChainsRef.current.get(key) ?? Promise.resolve()
    let queuedSave: Promise<void>
    queuedSave = previousSave.catch(() => undefined).then(async () => {
      try {
        const response = await fetch('/api/teacher/gradebook', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroom_id: classroomId,
            assessment_type: column.assessment_type,
            assessment_id: column.assessment_id,
            gradebook_weight: nextWeight,
          }),
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Failed to save assessment weight')
        }
        if (currentClassroomIdRef.current !== classroomId) return

        setAssessmentColumns((previous) => previous.map((assessmentColumn) => (
          getAssessmentColumnKey(assessmentColumn) === key
            ? { ...assessmentColumn, weight: nextWeight }
            : assessmentColumn
        )))
        if (dirtyWeightsRef.current.get(key) === rawValue) {
          dirtyWeightsRef.current.delete(key)
          setAssessmentWeightDrafts((previous) => ({ ...previous, [key]: String(nextWeight) }))
        }
        invalidateCachedJSONMatching(`gradebook:${classroomId}:`)
        await loadGradebook({ preserveSnapshot: true })
      } catch (err: unknown) {
        if (currentClassroomIdRef.current !== classroomId) return
        if (dirtyWeightsRef.current.get(key) === rawValue) {
          dirtyWeightsRef.current.delete(key)
          setAssessmentWeightDrafts((previous) => ({ ...previous, [key]: String(column.weight) }))
        }
        setActionError(err instanceof Error ? err.message : 'Failed to save assessment weight')
      }
    }).finally(() => {
      if (assessmentSaveChainsRef.current.get(key) === queuedSave) {
        assessmentSaveChainsRef.current.delete(key)
        setSavingAssessmentKeys((previous) => {
          const next = new Set(previous)
          next.delete(key)
          return next
        })
      }
    })
    assessmentSaveChainsRef.current.set(key, queuedSave)
    await queuedSave
  }

  async function saveGradebookCategories(nextCategories: GradebookCategory[]) {
    if (isReadOnly || dialogSaving) return
    const classroomId = classroom.id
    const requestId = dialogSaveSequenceRef.current + 1
    dialogSaveSequenceRef.current = requestId
    setDialogSaving(true)
    setDialogError('')
    try {
      const response = await fetch('/api/teacher/gradebook', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroom_id: classroomId,
          categories: nextCategories.map((category) => ({
            id: category.id,
            name: category.name,
            percentage: category.percentage,
            default_assessment_weight: category.default_assessment_weight,
            is_default: category.is_default,
          })),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to save gradebook categories')
      if (
        dialogSaveSequenceRef.current !== requestId
        || currentClassroomIdRef.current !== classroomId
      ) return

      setCategories(data.categories || nextCategories)
      setGradebookEditorOpen(false)
      invalidateCachedJSONMatching(`gradebook:${classroomId}:`)
      await loadGradebook({ preserveSnapshot: true })
      if (
        dialogSaveSequenceRef.current !== requestId
        || currentClassroomIdRef.current !== classroomId
      ) return
      showMessage({ text: 'Gradebook categories saved', tone: 'success' })
    } catch (error: unknown) {
      if (
        dialogSaveSequenceRef.current !== requestId
        || currentClassroomIdRef.current !== classroomId
      ) return
      setDialogError(error instanceof Error ? error.message : 'Failed to save gradebook categories')
    } finally {
      if (
        dialogSaveSequenceRef.current === requestId
        && currentClassroomIdRef.current === classroomId
      ) setDialogSaving(false)
    }
  }

  async function saveAssessmentDetails(title: string, categoryId: string | null, weight: number) {
    if (!selectedAssessment || isReadOnly || dialogSaving) return
    const classroomId = classroom.id
    const assessment = selectedAssessment
    const requestId = dialogSaveSequenceRef.current + 1
    dialogSaveSequenceRef.current = requestId
    setDialogSaving(true)
    setDialogError('')
    try {
      await saveGradebookAssessment({ classroomId, assessment, title, categoryId, weight })
      if (
        dialogSaveSequenceRef.current !== requestId
        || currentClassroomIdRef.current !== classroomId
      ) return

      setSelectedAssessment(null)
      invalidateCachedJSONMatching(`gradebook:${classroomId}:`)
      await loadGradebook({ preserveSnapshot: true })
      if (
        dialogSaveSequenceRef.current !== requestId
        || currentClassroomIdRef.current !== classroomId
      ) return
      showMessage({ text: 'Assessment details saved', tone: 'success' })
    } catch (error: unknown) {
      if (
        dialogSaveSequenceRef.current !== requestId
        || currentClassroomIdRef.current !== classroomId
      ) return
      setDialogError(error instanceof Error ? error.message : 'Failed to save assessment details')
      // A title write may have committed before the details write failed.
      void loadGradebook({ preserveSnapshot: true })
    } finally {
      if (
        dialogSaveSequenceRef.current === requestId
        && currentClassroomIdRef.current === classroomId
      ) setDialogSaving(false)
    }
  }

  const hasManualChanges = students.some((student) => (
    student.is_final_override || student.assessment_scores?.some((cell) => cell.is_manual_override)
  ))

  function scoreSaveKey(target: GradebookScoreEditTarget) {
    return target.kind === 'final'
      ? `${target.student.student_id}:final`
      : `${target.student.student_id}:${getAssessmentColumnKey(target.column)}`
  }

  async function saveManualScore(earned: number) {
    if (!scoreEditTarget || isReadOnly || !scoreOverridesAvailable) return
    const classroomId = classroom.id
    const target = scoreEditTarget
    const key = scoreSaveKey(target)
    const requestId = scoreMutationSequenceRef.current + 1
    scoreMutationSequenceRef.current = requestId
    setSavingScoreKeys((current) => new Set(current).add(key))
    setScoreDialogError('')
    try {
      const response = await fetch('/api/teacher/gradebook/manual-scores', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroom_id: classroomId,
          student_id: target.student.student_id,
          assessment_type: target.kind === 'final' ? 'final' : target.column.assessment_type,
          assessment_id: target.kind === 'final' ? classroomId : target.column.assessment_id,
          earned,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to save override')
      if (
        scoreMutationSequenceRef.current !== requestId
        || currentClassroomIdRef.current !== classroomId
      ) return
      setScoreEditTarget(null)
      invalidateCachedJSONMatching(`gradebook:${classroomId}:`)
      await loadGradebook({ preserveSnapshot: true })
      if (
        scoreMutationSequenceRef.current !== requestId
        || currentClassroomIdRef.current !== classroomId
      ) return
      showMessage({ text: 'Override saved', tone: 'success' })
    } catch (error: unknown) {
      if (
        scoreMutationSequenceRef.current !== requestId
        || currentClassroomIdRef.current !== classroomId
      ) return
      setScoreDialogError(error instanceof Error ? error.message : 'Failed to save override')
    } finally {
      if (
        scoreMutationSequenceRef.current === requestId
        && currentClassroomIdRef.current === classroomId
      ) {
        setSavingScoreKeys((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
      }
    }
  }

  async function undoManualScores(target?: GradebookScoreEditTarget) {
    if (isReadOnly || !scoreOverridesAvailable) return false
    const classroomId = classroom.id
    const key = target ? scoreSaveKey(target) : null
    const requestId = scoreMutationSequenceRef.current + 1
    scoreMutationSequenceRef.current = requestId
    if (key) setSavingScoreKeys((current) => new Set(current).add(key))
    else setUndoAllSaving(true)
    setActionError('')
    try {
      const response = await fetch('/api/teacher/gradebook/manual-scores', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target ? {
          scope: 'one',
          classroom_id: classroomId,
          student_id: target.student.student_id,
          assessment_type: target.kind === 'final' ? 'final' : target.column.assessment_type,
          assessment_id: target.kind === 'final' ? classroomId : target.column.assessment_id,
        } : { scope: 'all', classroom_id: classroomId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to undo overrides')
      if (
        scoreMutationSequenceRef.current !== requestId
        || currentClassroomIdRef.current !== classroomId
      ) return false
      setUndoAllOpen(false)
      invalidateCachedJSONMatching(`gradebook:${classroomId}:`)
      await loadGradebook({ preserveSnapshot: true })
      if (
        scoreMutationSequenceRef.current !== requestId
        || currentClassroomIdRef.current !== classroomId
      ) return false
      showMessage({ text: target ? 'Override undone' : 'All overrides undone', tone: 'success' })
      return true
    } catch (error: unknown) {
      if (
        scoreMutationSequenceRef.current !== requestId
        || currentClassroomIdRef.current !== classroomId
      ) return false
      const message = error instanceof Error ? error.message : 'Failed to undo overrides'
      if (target) setScoreDialogError(message)
      else setActionError(message)
      return false
    } finally {
      if (
        scoreMutationSequenceRef.current === requestId
        && currentClassroomIdRef.current === classroomId
      ) {
        if (key) setSavingScoreKeys((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
        else setUndoAllSaving(false)
      }
    }
  }

  const actionBar = (
    <GradebookToolbar
      preferences={preferences}
      onChange={updatePreferences}
      selectedCount={selectedIds.size}
      isReadOnly={isReadOnly || !hasCurrentSnapshot || !categorySchemaAvailable || savingAssessmentKeys.size > 0}
      classAverage={classAverage}
      classMedian={classMedian}
      mobileStudentOptions={sortedStudents.map((student) => ({ value: student.student_id, label: getStudentName(student) }))}
      mobileStudentId={mobileStudent?.student_id ?? ''}
      onMobileStudentChange={setSelectedStudentId}
      hasManualChanges={hasManualChanges}
      undoingManualChanges={undoAllSaving}
      onUndoManualChanges={() => setUndoAllOpen(true)}
      onEditCategories={() => { setDialogError(''); setGradebookEditorOpen(true) }}
      onCopyEmails={() => { void copySelectedEmailsToClipboard() }}
      onCopySecondaryEmails={email2.loading || email2.error ? undefined : () => {
        void copySelectedEmailsToClipboard(getGradebookEmail2Addresses(email2.rows, selectedIds), 'Email 2 addresses')
      }}
      onExport={() => downloadGradebookCsv(students, assessmentColumns, scoreDisplayMode)}
    />
  )

  const gradebookTable = (
    <GradebookTable
      students={sortedStudents} columns={assessmentColumns} displayMode={scoreDisplayMode}
      lastNameFirst={preferences.lastNameFirst}
      showStudentIds={preferences.showStudentIds} showWeights={preferences.showWeights}
      keepKeyColumnsVisible={preferences.keepKeyColumnsVisible}
      columnWidths={columnWidths} onColumnWidthChange={setColumnWidth}
      weightDrafts={assessmentWeightDrafts} savingKeys={savingAssessmentKeys}
      isReadOnly={isReadOnly || !categorySchemaAvailable}
      scoreEditingDisabled={isReadOnly || !scoreOverridesAvailable}
      onWeightDraftChange={handleAssessmentWeightDraftChange} onWeightCommit={handleAssessmentWeightCommit}
      onAssessmentOpen={(column) => {
        if (savingAssessmentKeys.size) { showMessage({ text: 'Wait for the weight save to finish', tone: 'info' }); return }
        setDialogError(''); setSelectedAssessment(column)
      }}
      onScoreOpen={(student, column) => {
        if (!scoreOverridesAvailable) {
          showMessage({ text: 'Manual marks require the latest database update', tone: 'info' })
          return
        }
        setScoreDialogError('')
        setScoreEditTarget({ kind: 'assessment', student, column })
      }}
      onFinalScoreOpen={(student) => {
        if (!scoreOverridesAvailable) {
          showMessage({ text: 'Overrides require the latest database update', tone: 'info' })
          return
        }
        setScoreDialogError('')
        setScoreEditTarget({ kind: 'final', student })
      }}
      savingScoreKeys={savingScoreKeys}
      selectedIds={selectedIds} allSelected={allSelected} someSelected={someSelected}
      toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll}
      selectedStudentId={selectedStudentId} onStudentSelect={handleStudentSelect}
      onStudentDeselect={() => { setSelectedStudentId(null); clearSelection() }}
      sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort}
      scrollContainerRef={gradebookTableScrollRef} onScroll={preserveGradebookTableScrollPosition}
    />
  )

  const studentAssessmentPanel = selectedStudent ? (
    <GradebookStudentPanel
      student={selectedStudent}
      columns={assessmentColumns}
      displayMode={scoreDisplayMode}
      onClose={() => setSelectedStudentId(null)}
    />
  ) : undefined

  const retryAction = loadError || isRetrying ? (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-label={isRetrying ? 'Retrying gradebook' : 'Retry loading gradebook'}
      aria-disabled={isRetrying || undefined}
      className={isRetrying ? 'cursor-not-allowed opacity-50' : undefined}
      onClick={isRetrying ? undefined : retryGradebookLoad}
    >
      {isRetrying ? 'Retrying...' : 'Retry'}
    </Button>
  ) : null

  const gradesWorkspace = !hasCurrentSnapshot ? (
    <PageState
      kind={loading ? 'loading' : 'error'}
      title={loading ? 'Loading gradebook' : 'Gradebook unavailable'}
      description={loading ? 'Loading this classroom\'s grades.' : loadError}
      action={retryAction}
      compact
    />
  ) : (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
      {loading ? <RefreshingIndicator label="Refreshing gradebook" /> : null}
      {loadError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger"
        >
          <span>Gradebook could not be refreshed. Showing the last loaded grades.</span>
          {retryAction}
        </div>
      ) : null}
      <div className="hidden h-full min-h-0 flex-1 lg:flex">
        <TeacherWorkspaceSplit
          className="h-full flex-1"
          splitVariant="gapped"
          primary={gradebookTable}
          inspector={studentAssessmentPanel}
          inspectorWidth={detailPaneWidth}
          onInspectorWidthChange={setDetailPaneWidth}
          inspectorCollapsed={false}
          inspectorClassName="min-h-72 rounded-lg border border-border bg-surface"
          dividerLabel="Resize gradebook details"
          defaultInspectorWidth={32}
          minInspectorPx={300}
          minPrimaryPx={420}
          minInspectorPercent={24}
          maxInspectorPercent={45}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface lg:hidden">
        {mobileStudent ? (
          <GradebookStudentPanel
            student={mobileStudent}
            columns={assessmentColumns}
            displayMode={scoreDisplayMode}
          />
        ) : (
          <div className="px-3 py-6 text-sm text-text-muted">No students enrolled yet.</div>
        )}
      </div>
    </div>
  )

  return (
    <>
      <TeacherWorkSurfaceShell
        state="workspace"
        workspaceFrame="standalone"
        primary={actionBar}
        feedback={
          actionError || email2.error ? <div className="space-y-2">
            {actionError ? <div role="alert" className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">{actionError}</div> : null}
            {email2.error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
              <span>Email 2 addresses could not be loaded. Grades are still available.</span>
              <Button variant="secondary" onClick={() => { void email2.reload() }}>Retry Email 2</Button>
            </div> : null}
          </div> : null
        }
        summary={null}
        workspace={gradesWorkspace}
        workspaceFrameClassName="min-h-80 border-0 bg-page"
      />
      <GradebookEditorDialog
        isOpen={gradebookEditorOpen}
        categories={categories}
        isSaving={dialogSaving}
        error={dialogError}
        onClose={() => {
          if (dialogSaving) return
          setGradebookEditorOpen(false)
          setDialogError('')
        }}
        onSave={saveGradebookCategories}
      />
      <GradebookAssessmentDialog
        isOpen={Boolean(selectedAssessment)}
        assessment={selectedAssessment}
        assessments={assessmentColumns}
        categories={categories}
        isSaving={dialogSaving}
        error={dialogError}
        onClose={() => {
          if (dialogSaving) return
          setSelectedAssessment(null)
          setDialogError('')
        }}
        onSave={saveAssessmentDetails}
      />
      <GradebookScoreDialog
        isOpen={Boolean(scoreEditTarget)}
        student={scoreEditTarget?.student ?? null}
        target={scoreEditTarget
          ? scoreEditTarget.kind === 'final'
            ? { kind: 'final', title: 'Final', value: scoreEditTarget.student.final_percent, isOverride: scoreEditTarget.student.is_final_override, undoValue: scoreEditTarget.student.calculated_final_percent }
            : (() => {
                const cell = getAssessmentCell(scoreEditTarget.student, scoreEditTarget.column)
                return { kind: 'assessment' as const, title: scoreEditTarget.column.title, value: cell?.earned ?? null, possible: scoreEditTarget.column.possible, isOverride: cell?.is_manual_override, undoValue: cell?.calculated_earned }
              })()
          : null}
        isSaving={scoreEditTarget ? savingScoreKeys.has(scoreSaveKey(scoreEditTarget)) : false}
        error={scoreDialogError}
        onClose={() => { setScoreEditTarget(null); setScoreDialogError('') }}
        onSave={saveManualScore}
        onUndo={scoreEditTarget ? () => undoManualScores(scoreEditTarget) : undefined}
      />
      <ConfirmDialog
        isOpen={undoAllOpen}
        title="Undo all overrides?"
        description="This restores the calculated mark for every overridden Gradebook cell."
        confirmLabel="Undo all"
        isCancelDisabled={undoAllSaving}
        isConfirmDisabled={undoAllSaving}
        onCancel={() => { if (!undoAllSaving) setUndoAllOpen(false) }}
        onConfirm={() => { void undoManualScores() }}
      />
    </>
  )
}
