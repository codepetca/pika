'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, ConfirmDialog, FormField, Input, PageHeading, SaveStatus, Select, TabPanel, Tabs } from '@/ui'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import { Spinner } from '@/components/Spinner'
import { CourseBlueprintPurgeDialog } from '@/components/CourseBlueprintPurgeDialog'
import { BlueprintAuthoringGuidanceEditor } from '@/components/BlueprintAuthoringGuidanceEditor'
import { CreateBlueprintModal } from '@/components/CreateBlueprintModal'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import { useMarkdownPreference } from '@/contexts/MarkdownPreferenceContext'
import {
  markdownToCourseBlueprintAssignments,
} from '@/lib/course-blueprint-assignments'
import {
  markdownToCourseBlueprintAssessments,
} from '@/lib/course-blueprint-assessments-markdown'
import {
  markdownToCourseBlueprintLessonTemplates,
} from '@/lib/course-blueprint-lesson-templates'
import {
  markdownToCourseBlueprintMaterials,
} from '@/lib/course-blueprint-materials'
import {
  markdownToCourseBlueprintSurveys,
} from '@/lib/course-blueprint-surveys'
import {
  DEFAULT_PLANNED_COURSE_SITE_CONFIG,
  slugifyCourseSiteValue,
} from '@/lib/course-site-publishing'
import {
  fetchTeacherBlueprintDetail,
  fetchTeacherBlueprints,
  invalidateTeacherBlueprints,
} from '@/lib/teacher-blueprints-client'
import {
  courseBlueprintImportRequestInit,
  resolveCourseBlueprintImportOperation,
  type CourseBlueprintImportOperation,
} from '@/lib/course-blueprint-import-client'
import {
  courseBlueprintEditorStateFromDetail,
  emptyCourseBlueprintDraftState,
  getCourseBlueprintDirtySections,
  normalizePlannedCourseSiteConfig,
  type CourseBlueprintEditorSection,
  type CourseBlueprintEditorState,
  type CourseBlueprintMarkdownTab,
} from '@/lib/course-blueprint-editor-state'
import type {
  BlueprintMergeSuggestionSet,
  CourseBlueprint,
  CourseBlueprintDetail,
  PlannedCourseSiteConfig,
} from '@/types'
import {
  EMPTY_COURSE_BLUEPRINT_AUTHORING_GUIDANCE,
  type CourseBlueprintAuthoringGuidance,
} from '@/lib/course-blueprint-authoring-guidance'
import type { CourseBlueprintGuidanceRevision } from '@/lib/course-blueprint-guidance-history'

type EditorTab =
  | 'overview'
  | 'outline'
  | 'resources'
  | 'assignments'
  | 'tests'
  | 'lesson-plans'
  | 'materials'
  | 'surveys'
  | 'grading'
  | 'copilot'
  | 'publish'
  | 'sync'
  | 'proposals'
  | 'guidance'
  | 'details'

function isEditorTab(value: string | null): value is EditorTab {
  return value !== null && Object.prototype.hasOwnProperty.call(TAB_LABELS, value)
}

type CopilotTarget = Exclude<EditorTab, 'copilot' | 'publish' | 'sync' | 'proposals'>

const TAB_LABELS: Record<EditorTab, string> = {
  overview: 'Overview',
  outline: 'Outline',
  resources: 'Resources',
  assignments: 'Assignments',
  tests: 'Tests',
  'lesson-plans': 'Lesson Plans',
  materials: 'Materials',
  surveys: 'Surveys',
  grading: 'Grading',
  copilot: 'AI Drafting',
  publish: 'Publish',
  sync: 'Classroom Updates',
  proposals: 'Proposals',
  guidance: 'Authoring Guidance',
  details: 'Course Details',
}

type WorkspaceTab = 'overview' | 'content' | 'guidance' | 'updates' | 'settings'

const WORKSPACE_TABS: Array<{ value: WorkspaceTab; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'content', label: 'Content' },
  { value: 'guidance', label: 'Authoring Guidance' },
  { value: 'updates', label: 'Updates' },
  { value: 'settings', label: 'Settings' },
]

const WORKSPACE_SECTIONS: Record<WorkspaceTab, EditorTab[]> = {
  overview: ['overview'],
  content: ['outline', 'resources', 'assignments', 'tests', 'lesson-plans', 'materials', 'surveys', 'copilot'],
  guidance: ['guidance'],
  updates: ['sync', 'proposals'],
  settings: ['details', 'grading', 'publish'],
}

function workspaceForTab(tab: EditorTab): WorkspaceTab {
  if (tab === 'overview' || tab === 'guidance') return tab
  if (WORKSPACE_SECTIONS.content.includes(tab)) return 'content'
  if (WORKSPACE_SECTIONS.updates.includes(tab)) return 'updates'
  return 'settings'
}

const PLANNED_SITE_CONFIG_OPTIONS: Array<[keyof PlannedCourseSiteConfig, string]> = [
  ['overview', 'overview'],
  ['outline', 'outline'],
  ['resources', 'resources'],
  ['assignments', 'assignments'],
  ['tests', 'tests'],
  ['lesson_plans', 'lesson plans'],
]

type MarkdownEditorTab = CourseBlueprintMarkdownTab

type BlueprintDeleteTarget = {
  id: string
  title: string
}

type PendingUnsavedAction = {
  title: string
  description: string
  confirmLabel: string
  destructive: boolean
  onConfirm: () => void | Promise<void>
}

const DIRTY_SECTION_LABELS: Record<CourseBlueprintEditorSection, string> = {
  metadata: 'course details',
  'planned-site': 'planned site',
  grading: 'grading',
  guidance: 'authoring guidance',
  overview: 'overview',
  outline: 'outline',
  resources: 'resources',
  assignments: 'assignments',
  tests: 'tests',
  'lesson-plans': 'lesson plans',
  materials: 'materials',
  surveys: 'surveys',
}

type BlueprintProposal = {
  id: string
  source_kind: 'classroom' | 'package' | 'repository' | 'ai' | 'blueprint'
  target_kind: 'blueprint' | 'classroom'
  target_classroom_id: string | null
  status: 'ready' | 'needs_review' | 'conflicted' | 'stale' | 'applied' | 'rejected'
  base_blueprint_revision: number
  base_classroom_revision: number | null
  applied_blueprint_revision: number | null
  applied_classroom_revision: number | null
  operations_json: Array<{
    action: 'singleton' | 'add' | 'update' | 'move' | 'archive'
    key?: string
    collection?: string
    artifact_id?: string
    before?: { title?: string }
    after?: { title?: string }
    from_position?: number
    to_position?: number
  }>
  diff_json: {
    summary?: {
      add?: number
      update?: number
      move?: number
      archive?: number
      singleton?: number
    }
    guidance_provenance?: {
      blueprint_revision: number
      unit_label: string | null
      rules_markdown: string
    }
  }
  created_at: string
}

export default function TeacherBlueprintsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { showMarkdown } = useMarkdownPreference()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const importInFlightRef = useRef(false)
  const importOperationRef = useRef<CourseBlueprintImportOperation | null>(null)
  const [blueprints, setBlueprints] = useState<CourseBlueprint[]>([])
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CourseBlueprintDetail | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showCreateClassroom, setShowCreateClassroom] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BlueprintDeleteTarget | null>(null)
  const [activeTab, setActiveTab] = useState<EditorTab>(() => {
    const section = searchParams.get('section')
    return isEditorTab(section) ? section : 'overview'
  })
  const [drafts, setDrafts] = useState(emptyCourseBlueprintDraftState)
  const [meta, setMeta] = useState({
    title: '',
    subject: '',
    grade_level: '',
    course_code: '',
    term_template: '',
  })
  const [error, setError] = useState('')
  const [importingPackage, setImportingPackage] = useState(false)
  const [saving, setSaving] = useState(false)
  const [plannedSite, setPlannedSite] = useState<{
    slug: string
    published: boolean
    config: PlannedCourseSiteConfig
  }>({
    slug: '',
    published: false,
    config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
  })
  const [grading, setGrading] = useState({
    use_weights: false,
    assignments_weight: 70,
    tests_weight: 30,
  })
  const [guidance, setGuidance] = useState<CourseBlueprintAuthoringGuidance>(
    EMPTY_COURSE_BLUEPRINT_AUTHORING_GUIDANCE,
  )
  const [guidanceHistory, setGuidanceHistory] = useState<CourseBlueprintGuidanceRevision[]>([])
  const [guidanceHistoryLoading, setGuidanceHistoryLoading] = useState(false)
  const [guidanceHistoryError, setGuidanceHistoryError] = useState('')
  const [savedEditorState, setSavedEditorState] = useState<CourseBlueprintEditorState | null>(null)
  const [pendingUnsavedAction, setPendingUnsavedAction] = useState<PendingUnsavedAction | null>(null)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiTarget, setAiTarget] = useState<CopilotTarget>('overview')
  const [aiUnitExceptionId, setAiUnitExceptionId] = useState('')
  const [aiPreview, setAiPreview] = useState<{
    target: CopilotTarget
    content: string
    originalContentSha256?: string
    draftProvenanceToken?: string
    guidance?: {
      blueprint_revision: number
      unit_exception_id: string | null
      unit_label: string | null
      rules_markdown: string
      trial: boolean
    }
  } | null>(null)
  const [aiAnalysis, setAiAnalysis] = useState<any>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [mergeClassroomId, setMergeClassroomId] = useState('')
  const [mergeSuggestions, setMergeSuggestions] = useState<BlueprintMergeSuggestionSet | null>(null)
  const [mergeSelection, setMergeSelection] = useState<Record<string, boolean>>({})
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergeApplying, setMergeApplying] = useState(false)
  const [classroomProposalPreparing, setClassroomProposalPreparing] = useState(false)
  const [proposals, setProposals] = useState<BlueprintProposal[]>([])
  const [proposalsLoading, setProposalsLoading] = useState(false)
  const [proposalsError, setProposalsError] = useState('')
  const [applyingProposalId, setApplyingProposalId] = useState<string | null>(null)
  const listRequestIdRef = useRef(0)
  const detailRequestIdRef = useRef(0)
  const proposalsRequestIdRef = useRef(0)
  const guidanceHistoryRequestIdRef = useRef(0)
  const mergeSuggestionsRequestIdRef = useRef(0)
  const selectedBlueprintIdRef = useRef<string | null>(null)
  selectedBlueprintIdRef.current = selectedBlueprintId
  const preferredBlueprintId = searchParams.get('blueprint')
  const fromClassroomId = searchParams.get('fromClassroom')
  const reviewClassroomId = searchParams.get('reviewClassroom')
  const openedReviewClassroomRef = useRef<string | null>(null)

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('section') !== activeTab) {
      url.searchParams.set('section', activeTab)
      window.history.replaceState(null, '', url)
    }
  }, [activeTab])

  useEffect(() => {
    const onPopState = () => {
      const section = new URL(window.location.href).searchParams.get('section')
      setActiveTab(isEditorTab(section) ? section : 'overview')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const currentEditorState = useMemo<CourseBlueprintEditorState>(() => ({
    metadata: meta,
    plannedSite,
    grading,
    guidance,
    drafts,
  }), [drafts, grading, guidance, meta, plannedSite])
  const dirtySections = useMemo(
    () => savedEditorState
      ? getCourseBlueprintDirtySections(currentEditorState, savedEditorState)
      : [],
    [currentEditorState, savedEditorState],
  )
  const hasUnsavedChanges = dirtySections.length > 0
  const editorWriteLocked = saving
    || importingPackage
    || loadingDetail
    || applyingProposalId !== null
    || classroomProposalPreparing
  const dirtySectionSummary = dirtySections
    .map((section) => DIRTY_SECTION_LABELS[section])
    .join(', ')
  const activeWorkspace = workspaceForTab(activeTab)

  const counts = useMemo(() => {
    if (!detail) return null
    return {
      assignments: detail.assignments.length,
      tests: detail.assessments.filter((assessment) => assessment.assessment_type === 'test').length,
      lesson_templates: detail.lesson_templates.length,
      materials: (detail.materials || []).length,
      surveys: (detail.surveys || []).length,
    }
  }, [detail])
  const repositoryManaged = detail?.authority_mode === 'repository'
  const canDeleteSelectedBlueprint =
    detail?.id === selectedBlueprintId && !repositoryManaged
  const actionableProposalCount = useMemo(
    () => proposals.filter((proposal) =>
      proposal.status === 'ready' || proposal.status === 'needs_review'
    ).length,
    [proposals]
  )

  const entryNotice = useMemo(() => {
    if (!fromClassroomId || !preferredBlueprintId || selectedBlueprintId !== preferredBlueprintId) return ''
    const classroomTitle = detail?.linked_classrooms.find((classroom) => classroom.id === fromClassroomId)?.title
    return classroomTitle
      ? `Course blueprint saved from ${classroomTitle}. Review it here, then use it for another classroom or export the course package.`
      : 'Course blueprint saved from classroom content. Review it here, then use it for another classroom or export the course package.'
  }, [detail, fromClassroomId, preferredBlueprintId, selectedBlueprintId])

  useEffect(() => {
    if (!hasUnsavedChanges) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  const replaceEditorWithDetail = useCallback((blueprint: CourseBlueprintDetail) => {
    const nextEditorState = courseBlueprintEditorStateFromDetail(blueprint)
    setDetail(blueprint)
    setSavedEditorState(nextEditorState)
    setMeta(nextEditorState.metadata)
    setPlannedSite(nextEditorState.plannedSite)
    setGrading(nextEditorState.grading)
    setGuidance(nextEditorState.guidance)
    setDrafts(nextEditorState.drafts)
  }, [])

  function syncSavedSection(
    section: CourseBlueprintEditorSection,
    nextEditorState: CourseBlueprintEditorState,
  ) {
    if (section === 'metadata') {
      setMeta(nextEditorState.metadata)
    } else if (section === 'planned-site') {
      setPlannedSite(nextEditorState.plannedSite)
    } else if (section === 'grading') {
      setGrading(nextEditorState.grading)
    } else if (section === 'guidance') {
      setGuidance(nextEditorState.guidance)
    } else {
      setDrafts((current) => ({
        ...current,
        [section]: nextEditorState.drafts[section],
      }))
    }
  }

  async function refreshDetailAfterSave(
    blueprintId: string,
    section: CourseBlueprintEditorSection,
  ) {
    const blueprint = await fetchTeacherBlueprintDetail(blueprintId)
    if (selectedBlueprintIdRef.current !== blueprintId) return

    const nextEditorState = courseBlueprintEditorStateFromDetail(blueprint)
    setDetail(blueprint)
    setSavedEditorState(nextEditorState)
    syncSavedSection(section, nextEditorState)
  }

  function requestUnsavedAction(
    action: () => void | Promise<void>,
    options: Omit<PendingUnsavedAction, 'onConfirm'>,
  ) {
    if (!hasUnsavedChanges) {
      void action()
      return
    }

    setPendingUnsavedAction({
      ...options,
      description: `${options.description} Unsaved sections: ${dirtySectionSummary}.`,
      onConfirm: action,
    })
  }

  const beginBlueprintSelection = useCallback((blueprintId: string | null) => {
    detailRequestIdRef.current += 1
    proposalsRequestIdRef.current += 1
    guidanceHistoryRequestIdRef.current += 1
    mergeSuggestionsRequestIdRef.current += 1
    selectedBlueprintIdRef.current = blueprintId
    setDeleteTarget(null)
    setDetail(null)
    setSavedEditorState(null)
    setProposals([])
    setProposalsError('')
    setProposalsLoading(false)
    setGuidanceHistory([])
    setGuidanceHistoryError('')
    setGuidanceHistoryLoading(false)
    setMergeSuggestions(null)
    setMergeSelection({})
    setMergeLoading(false)
    setLoadingDetail(blueprintId !== null)
    setSelectedBlueprintId(blueprintId)
  }, [])

  const loadBlueprints = useCallback(async (preferredId?: string) => {
    const requestId = listRequestIdRef.current + 1
    listRequestIdRef.current = requestId
    if (preferredId && preferredId !== selectedBlueprintIdRef.current) {
      beginBlueprintSelection(preferredId)
    }
    setLoadingList(true)
    setError('')
    try {
      const nextBlueprints = await fetchTeacherBlueprints()
      if (listRequestIdRef.current !== requestId) return
      setBlueprints(nextBlueprints)
      const nextSelectedId = preferredId
        || selectedBlueprintIdRef.current
        || nextBlueprints[0]?.id
        || null
      if (nextSelectedId !== selectedBlueprintIdRef.current) {
        beginBlueprintSelection(nextSelectedId)
      }
    } catch (err: any) {
      if (listRequestIdRef.current !== requestId) return
      setError(err.message || 'Failed to load course blueprints')
    } finally {
      if (listRequestIdRef.current !== requestId) return
      setLoadingList(false)
    }
  }, [beginBlueprintSelection])

  const loadDetail = useCallback(async (id: string) => {
    const requestId = detailRequestIdRef.current + 1
    detailRequestIdRef.current = requestId
    setLoadingDetail(true)
    setError('')
    try {
      const blueprint = await fetchTeacherBlueprintDetail(id)
      if (detailRequestIdRef.current !== requestId || selectedBlueprintIdRef.current !== id) return
      replaceEditorWithDetail(blueprint)
      setMergeClassroomId(blueprint.linked_classrooms[0]?.id || '')
      setMergeSuggestions(null)
      setMergeSelection({})
      setAiPreview(null)
      setAiAnalysis(null)
    } catch (err: any) {
      if (detailRequestIdRef.current !== requestId || selectedBlueprintIdRef.current !== id) return
      setError(err.message || 'Failed to load course blueprint')
    } finally {
      if (detailRequestIdRef.current !== requestId || selectedBlueprintIdRef.current !== id) return
      setLoadingDetail(false)
    }
  }, [replaceEditorWithDetail])

  async function loadProposals(id: string) {
    const requestId = proposalsRequestIdRef.current + 1
    proposalsRequestIdRef.current = requestId
    setProposalsLoading(true)
    setProposalsError('')
    try {
      const response = await fetch(`/api/teacher/course-blueprints/${id}/proposals`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load Blueprint proposals')
      if (
        proposalsRequestIdRef.current !== requestId
        || selectedBlueprintIdRef.current !== id
      ) return
      setProposals(data.proposals || [])
    } catch (err: any) {
      if (
        proposalsRequestIdRef.current !== requestId
        || selectedBlueprintIdRef.current !== id
      ) return
      setProposals([])
      setProposalsError(err.message || 'Failed to load Blueprint proposals')
    } finally {
      if (
        proposalsRequestIdRef.current === requestId
        && selectedBlueprintIdRef.current === id
      ) setProposalsLoading(false)
    }
  }

  const loadGuidanceHistory = useCallback(async (id: string) => {
    const requestId = guidanceHistoryRequestIdRef.current + 1
    guidanceHistoryRequestIdRef.current = requestId
    setGuidanceHistoryLoading(true)
    setGuidanceHistoryError('')
    try {
      const response = await fetch(`/api/teacher/course-blueprints/${id}/guidance/history`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to load guidance history')
      if (guidanceHistoryRequestIdRef.current !== requestId || selectedBlueprintIdRef.current !== id) return
      setGuidanceHistory(data.revisions || [])
    } catch (err: any) {
      if (guidanceHistoryRequestIdRef.current !== requestId || selectedBlueprintIdRef.current !== id) return
      setGuidanceHistory([])
      setGuidanceHistoryError(err.message || 'Failed to load guidance history')
    } finally {
      if (guidanceHistoryRequestIdRef.current === requestId && selectedBlueprintIdRef.current === id) {
        setGuidanceHistoryLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    loadBlueprints(preferredBlueprintId || undefined)
  }, [loadBlueprints, preferredBlueprintId])

  useEffect(() => {
    if (!selectedBlueprintId) {
      detailRequestIdRef.current += 1
      setDetail(null)
      setSavedEditorState(null)
      setProposals([])
      setLoadingDetail(false)
      return
    }
    loadDetail(selectedBlueprintId)
    loadProposals(selectedBlueprintId)
  }, [loadDetail, selectedBlueprintId])

  useEffect(() => {
    if (selectedBlueprintId && activeTab === 'guidance') {
      void loadGuidanceHistory(selectedBlueprintId)
    }
  }, [activeTab, loadGuidanceHistory, selectedBlueprintId])

  async function applyProposal(proposalId: string) {
    if (!selectedBlueprintId) return
    setApplyingProposalId(proposalId)
    setProposalsError('')
    try {
      const response = await fetch(
        `/api/teacher/course-blueprints/${selectedBlueprintId}/proposals/${proposalId}/apply`,
        { method: 'POST' }
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to apply Blueprint proposal')
      invalidateTeacherBlueprints()
      await Promise.all([
        loadDetail(selectedBlueprintId),
        loadProposals(selectedBlueprintId),
      ])
    } catch (err: any) {
      setProposalsError(err.message || 'Failed to apply Blueprint proposal')
      await loadProposals(selectedBlueprintId)
    } finally {
      setApplyingProposalId(null)
    }
  }

  async function prepareClassroomProposal() {
    if (!selectedBlueprintId || !mergeClassroomId) return
    const blueprintId = selectedBlueprintId
    setClassroomProposalPreparing(true)
    setProposalsError('')
    try {
      const response = await fetch(
        `/api/teacher/course-blueprints/${blueprintId}/proposals/classrooms`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ classroom_id: mergeClassroomId }),
        },
      )
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to prepare classroom update')
      }
      if (selectedBlueprintIdRef.current !== blueprintId) return
      setActiveTab('proposals')
      await loadProposals(blueprintId)
    } catch (err: any) {
      if (selectedBlueprintIdRef.current !== blueprintId) return
      setProposalsError(err.message || 'Failed to prepare classroom update')
    } finally {
      setClassroomProposalPreparing(false)
    }
  }

  async function saveMetadata() {
    if (!selectedBlueprintId) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meta),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save metadata')
      }
      invalidateTeacherBlueprints()
      await loadBlueprints()
      await refreshDetailAfterSave(selectedBlueprintId, 'metadata')
    } catch (err: any) {
      setError(err.message || 'Failed to save metadata')
    } finally {
      setSaving(false)
    }
  }

  function openDeleteConfirm() {
    if (!canDeleteSelectedBlueprint || !detail) return
    setDeleteTarget({
      id: detail.id,
      title: detail.title,
    })
  }

  function handleBlueprintPurgeCompleted() {
    if (!deleteTarget) return
    const remainingBlueprints = blueprints.filter(
      (blueprint) => blueprint.id !== deleteTarget.id,
    )
    const nextSelectedId = remainingBlueprints[0]?.id || null
    invalidateTeacherBlueprints()
    setBlueprints(remainingBlueprints)
    beginBlueprintSelection(nextSelectedId)
    setDeleteTarget(null)
    router.push('/teacher/blueprints')
    void loadBlueprints(nextSelectedId || undefined)
  }

  function selectBlueprint(blueprintId: string) {
    if (blueprintId === selectedBlueprintId) return
    requestUnsavedAction(
      () => {
        beginBlueprintSelection(blueprintId)
      },
      {
        title: 'Switch Course Blueprints?',
        description: 'Switching will discard changes that have not been saved.',
        confirmLabel: 'Discard and switch',
        destructive: true,
      },
    )
  }

  async function changeAuthorityMode() {
    if (!selectedBlueprintId || !detail) return
    setSaving(true)
    setError('')
    try {
      const nextMode = repositoryManaged ? 'pika' : 'repository'
      const response = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authority_mode: nextMode }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to change Blueprint authority')
      invalidateTeacherBlueprints()
      await Promise.all([
        loadBlueprints(),
        loadDetail(selectedBlueprintId),
      ])
    } catch (err: any) {
      setError(err.message || 'Failed to change Blueprint authority')
    } finally {
      setSaving(false)
    }
  }

  async function saveCurrentTab() {
    if (
      !selectedBlueprintId
      || !detail
      || activeTab === 'copilot'
      || activeTab === 'publish'
      || activeTab === 'sync'
      || activeTab === 'proposals'
      || activeTab === 'guidance'
      || activeTab === 'details'
    ) return
    setSaving(true)
    setError('')
    try {
      if (activeTab === 'overview' || activeTab === 'outline' || activeTab === 'resources') {
        const key =
          activeTab === 'overview'
            ? 'overview_markdown'
            : activeTab === 'outline'
              ? 'outline_markdown'
              : 'resources_markdown'
        const response = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [key]: drafts[activeTab] }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(data.error || 'Failed to save markdown')
        }
      } else if (activeTab === 'grading') {
        if (
          grading.use_weights
          && grading.assignments_weight + grading.tests_weight !== 100
        ) {
          throw new Error('Assignment and test weights must total 100%')
        }
        const response = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gradebook_use_weights: grading.use_weights,
            gradebook_assignments_weight: grading.assignments_weight,
            gradebook_tests_weight: grading.tests_weight,
          }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'Failed to save grading settings')
      } else if (activeTab === 'assignments') {
        const parsed = markdownToCourseBlueprintAssignments(drafts.assignments, detail.assignments)
        if (parsed.errors.length > 0) throw new Error(parsed.errors.join('\n'))
        const response = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}/assignments/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignments: parsed.assignments }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(data.error || 'Failed to save assignments')
        }
      } else if (activeTab === 'tests') {
        const parsed = markdownToCourseBlueprintAssessments(
          drafts[activeTab],
          detail.assessments as any,
          'test'
        )
        if (parsed.errors.length > 0) throw new Error(parsed.errors.join('\n'))
        const response = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}/assessments/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assessments: parsed.assessments,
            assessmentType: 'test',
          }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(data.error || 'Failed to save assessments')
        }
      } else if (activeTab === 'lesson-plans') {
        const parsed = markdownToCourseBlueprintLessonTemplates(drafts['lesson-plans'], detail.lesson_templates)
        if (parsed.errors.length > 0) throw new Error(parsed.errors.join('\n'))
        const response = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}/lesson-templates/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lesson_templates: parsed.lesson_templates }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(data.error || 'Failed to save lesson templates')
        }
      } else if (activeTab === 'materials') {
        const parsed = markdownToCourseBlueprintMaterials(
          drafts.materials,
          detail.materials,
        )
        if (parsed.errors.length > 0) throw new Error(parsed.errors.join('\n'))
        const response = await fetch(
          `/api/teacher/course-blueprints/${selectedBlueprintId}/materials/bulk`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ materials: parsed.materials }),
          },
        )
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'Failed to save materials')
      } else if (activeTab === 'surveys') {
        const parsed = markdownToCourseBlueprintSurveys(
          drafts.surveys,
          detail.surveys,
        )
        if (parsed.errors.length > 0) throw new Error(parsed.errors.join('\n'))
        const response = await fetch(
          `/api/teacher/course-blueprints/${selectedBlueprintId}/surveys/bulk`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ surveys: parsed.surveys }),
          },
        )
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'Failed to save surveys')
      }

      invalidateTeacherBlueprints()
      await loadBlueprints()
      await refreshDetailAfterSave(selectedBlueprintId, activeTab)
    } catch (err: any) {
      setError(err.message || 'Failed to save current tab')
    } finally {
      setSaving(false)
    }
  }

  async function savePlannedSite() {
    if (!selectedBlueprintId) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planned_site_slug: plannedSite.slug || null,
          planned_site_published: plannedSite.published,
          planned_site_config: normalizePlannedCourseSiteConfig(plannedSite.config),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save planned site settings')
      }
      invalidateTeacherBlueprints()
      await loadBlueprints()
      await refreshDetailAfterSave(selectedBlueprintId, 'planned-site')
    } catch (err: any) {
      setError(err.message || 'Failed to save planned site settings')
    } finally {
      setSaving(false)
    }
  }

  async function saveGuidance() {
    if (!selectedBlueprintId || !detail || repositoryManaged) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authoring_guidance: guidance,
          expected_content_revision: detail.content_revision,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to save authoring guidance')
      invalidateTeacherBlueprints()
      await loadBlueprints()
      await refreshDetailAfterSave(selectedBlueprintId, 'guidance')
      await loadGuidanceHistory(selectedBlueprintId)
    } catch (err: any) {
      setError(err.message || 'Failed to save authoring guidance')
    } finally {
      setSaving(false)
    }
  }

  const loadMergeSuggestions = useCallback(async (
    classroomId = mergeClassroomId,
  ) => {
    if (!selectedBlueprintId || !classroomId) return
    const blueprintId = selectedBlueprintId
    const requestId = mergeSuggestionsRequestIdRef.current + 1
    mergeSuggestionsRequestIdRef.current = requestId
    setMergeLoading(true)
    setError('')
    try {
      const response = await fetch(
        `/api/teacher/course-blueprints/${blueprintId}/merge-suggestions?classroomId=${encodeURIComponent(classroomId)}`
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load merge suggestions')
      }
      if (
        mergeSuggestionsRequestIdRef.current !== requestId
        || selectedBlueprintIdRef.current !== blueprintId
      ) return
      const suggestionSet = data.suggestion_set as BlueprintMergeSuggestionSet
      setMergeSuggestions(suggestionSet)
      setMergeSelection(
        Object.fromEntries(suggestionSet.suggestions.map((suggestion) => [suggestion.area, true]))
      )
    } catch (err: any) {
      if (
        mergeSuggestionsRequestIdRef.current !== requestId
        || selectedBlueprintIdRef.current !== blueprintId
      ) return
      setError(err.message || 'Failed to load merge suggestions')
    } finally {
      if (
        mergeSuggestionsRequestIdRef.current === requestId
        && selectedBlueprintIdRef.current === blueprintId
      ) setMergeLoading(false)
    }
  }, [mergeClassroomId, selectedBlueprintId])

  useEffect(() => {
    if (
      !reviewClassroomId
      || !preferredBlueprintId
      || selectedBlueprintId !== preferredBlueprintId
      || detail?.id !== preferredBlueprintId
      || !detail.linked_classrooms.some(
        (classroom) => classroom.id === reviewClassroomId,
      )
      || openedReviewClassroomRef.current === reviewClassroomId
    ) {
      return
    }

    openedReviewClassroomRef.current = reviewClassroomId
    setMergeClassroomId(reviewClassroomId)
    setActiveTab('sync')
    loadMergeSuggestions(reviewClassroomId)
  }, [
    detail,
    loadMergeSuggestions,
    preferredBlueprintId,
    reviewClassroomId,
    selectedBlueprintId,
  ])

  async function applyMergeSuggestions() {
    if (!selectedBlueprintId || !mergeClassroomId || !mergeSuggestions) return
    const selectedAreas = mergeSuggestions.suggestions
      .map((suggestion) => suggestion.area)
      .filter((area) => mergeSelection[area])

    if (selectedAreas.length === 0) {
      setError('Select at least one suggestion area to apply.')
      return
    }

    setMergeApplying(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}/merge-apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroomId: mergeClassroomId,
          expectedBlueprintRevision: mergeSuggestions.blueprint_revision,
          expectedClassroomRevision: mergeSuggestions.classroom_revision,
          areas: selectedAreas,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save classroom changes to the course blueprint')
      }
      setMergeSuggestions(null)
      setActiveTab('proposals')
      await loadProposals(selectedBlueprintId)
    } catch (err: any) {
      setError(err.message || 'Failed to save classroom changes to the course blueprint')
    } finally {
      setMergeApplying(false)
    }
  }

  async function handleExport() {
    if (!selectedBlueprintId || !detail) return
    setError('')
    try {
      const response = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}/export`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to export package')
      }

      const blob = await response.blob()
      const contentDisposition = response.headers.get('content-disposition') || ''
      const fileNameMatch = contentDisposition.match(/filename="([^"]+)"/i)
      const fileName =
        fileNameMatch?.[1] ||
        `${detail.title.replace(/\s+/g, '-').toLowerCase() || 'course-blueprint'}.course-package.tar`
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setError(err.message || 'Failed to export package')
    }
  }

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (importInFlightRef.current) {
      event.target.value = ''
      return
    }
    importInFlightRef.current = true
    setImportingPackage(true)
    setError('')
    try {
      const operation = await resolveCourseBlueprintImportOperation(file, importOperationRef.current)
      importOperationRef.current = operation
      const response = await fetch(
        '/api/teacher/course-blueprints/import',
        courseBlueprintImportRequestInit(operation),
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.errors?.join('\n') || data.error || 'Failed to import course package')
      }
      importOperationRef.current = null
      invalidateTeacherBlueprints()
      await loadBlueprints(data.blueprint.id)
    } catch (err: any) {
      setError(err.message || 'Failed to import course package')
    } finally {
      importInFlightRef.current = false
      setImportingPackage(false)
      if (event.target) event.target.value = ''
    }
  }

  async function runCopilot(
    target: CopilotTarget | 'analyze',
    trialGuidance?: CourseBlueprintAuthoringGuidance,
    unitExceptionId = aiUnitExceptionId,
  ) {
    if (!selectedBlueprintId) return
    setAiBusy(true)
    setError('')
    setAiPreview(null)
    try {
      const response = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}/ai/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          prompt: aiPrompt,
          unit_exception_id: target === 'assignments' || target === 'tests'
            ? unitExceptionId || null
            : null,
          trial_guidance: trialGuidance,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate copilot suggestion')
      }
      setAiAnalysis(data.suggestion.analysis || null)
      if (target !== 'analyze') {
        setAiPreview({
          target,
          content: data.suggestion.content || '',
          originalContentSha256: data.suggestion.original_content_sha256,
          draftProvenanceToken: data.suggestion.draft_provenance_token,
          guidance: data.suggestion.guidance,
        })
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate copilot suggestion')
    } finally {
      setAiBusy(false)
    }
  }

  async function applyCopilotPreview() {
    if (!selectedBlueprintId || !aiPreview) return
    setAiBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}/ai/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: aiPreview.target,
          content: aiPreview.content,
          original_content_sha256: aiPreview.originalContentSha256,
          draft_provenance_token: aiPreview.draftProvenanceToken,
          expected_blueprint_revision: aiPreview.guidance?.blueprint_revision,
          unit_exception_id: aiPreview.guidance?.unit_exception_id,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.errors?.join('\n') || data.error || 'Failed to apply copilot preview')
      }
      setAiPreview(null)
      setActiveTab('proposals')
      await loadProposals(selectedBlueprintId)
    } catch (err: any) {
      setError(err.message || 'Failed to apply copilot preview')
    } finally {
      setAiBusy(false)
    }
  }

  function requestDiscardingAction(
    action: () => void | Promise<void>,
    title: string,
    confirmLabel: string,
  ) {
    requestUnsavedAction(action, {
      title,
      description: 'Continuing will discard changes that have not been saved.',
      confirmLabel,
      destructive: true,
    })
  }

  function requestSavedVersionAction(
    action: () => void | Promise<void>,
    title: string,
    confirmLabel: string,
  ) {
    requestUnsavedAction(action, {
      title,
      description: 'The action will use the last saved Blueprint and will not include current edits.',
      confirmLabel,
      destructive: false,
    })
  }

  return (
    <PageLayout width="wide">
      <PageActionBar
        primary={
          <div>
            <div className="text-sm font-medium text-text-default">Course Blueprints</div>
            <div className="text-xs text-text-muted">Build, publish, export, and reuse course packages.</div>
          </div>
        }
        actions={[
          {
            id: 'back-classrooms',
            label: 'Classrooms',
            disabled: editorWriteLocked,
            onSelect: () => requestDiscardingAction(
              () => router.push('/classrooms'),
              'Leave Course Blueprints?',
              'Discard and leave',
            ),
          },
          {
            id: 'new-blueprint',
            label: 'Create course blueprint',
            icon: Plus,
            primary: !selectedBlueprintId,
            disabled: editorWriteLocked,
            onSelect: () => requestDiscardingAction(
              () => setShowCreate(true),
              'Create another Course Blueprint?',
              'Discard and continue',
            ),
          },
          {
            id: 'import-package',
            label: importingPackage ? 'Importing Course Package...' : 'Import Course Package',
            disabled: editorWriteLocked,
            onSelect: () => requestDiscardingAction(
              () => importInputRef.current?.click(),
              'Import another Course Blueprint?',
              'Discard and choose file',
            ),
          },
          ...(selectedBlueprintId
            ? [
                {
                  id: 'create-classroom',
                  label: 'Create classroom from blueprint',
                  icon: Plus,
                  primary: true,
                  disabled: editorWriteLocked,
                  onSelect: () => requestSavedVersionAction(
                    () => setShowCreateClassroom(true),
                    'Use the saved Blueprint?',
                    'Use saved version',
                  ),
                },
                {
                  id: 'export-package',
                  label: 'Export Course Package',
                  disabled: editorWriteLocked,
                  onSelect: () => requestSavedVersionAction(
                    handleExport,
                    'Export the saved Blueprint?',
                    'Export saved version',
                  ),
                },
                ...(plannedSite.published && plannedSite.slug
                  ? [{ id: 'open-planned-site', label: 'Open Planned Site', onSelect: () => window.open(`/planned/${plannedSite.slug}`, '_blank') }]
                  : []),
                ...(canDeleteSelectedBlueprint
                  ? [{
                      id: 'delete-blueprint',
                      label: 'Delete permanently',
                      destructive: true,
                      disabled: editorWriteLocked,
                      onSelect: () => requestDiscardingAction(
                        openDeleteConfirm,
                        'Delete this Course Blueprint?',
                        'Discard and review deletion',
                      ),
                    }]
                  : []),
              ]
            : []),
        ]}
      />

      <PageContent className="pb-10">
        <input
          ref={importInputRef}
          type="file"
          accept="application/x-tar,.tar,application/json,.json"
          className="hidden"
          onChange={handleImportFile}
        />

        {error ? (
          <div className="mb-4 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>
        ) : null}

        {entryNotice ? (
          <div className="mb-4 rounded-md border border-border bg-info-bg px-3 py-2 text-sm text-text-default">
            {entryNotice}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[320px,minmax(0,1fr)]">
          <aside className="self-start rounded-card border border-border bg-surface p-4">
            {loadingList ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : blueprints.length === 0 ? (
              <div className="space-y-3 text-center">
                <p className="text-sm text-text-muted">No course blueprints yet.</p>
                <Button type="button" onClick={() => setShowCreate(true)}>
                  Create Course Blueprint
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {blueprints.map((blueprint) => (
                  <button
                    key={blueprint.id}
                    type="button"
                    onClick={() => selectBlueprint(blueprint.id)}
                    disabled={saving
                      || importingPackage
                      || applyingProposalId !== null
                      || classroomProposalPreparing}
                    className={`w-full rounded-card border px-3 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      selectedBlueprintId === blueprint.id
                        ? 'border-primary bg-info-bg'
                        : 'border-border hover:bg-surface-hover'
                    }`}
                  >
                    <div className="text-sm font-semibold text-text-default">{blueprint.title}</div>
                    <div className="mt-1 text-xs text-text-muted">
                      {[blueprint.subject, blueprint.grade_level, blueprint.course_code].filter(Boolean).join(' • ') || 'No metadata yet'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <section className="min-w-0 rounded-card border border-border bg-surface p-4">
            {!selectedBlueprintId || !detail || detail.id !== selectedBlueprintId ? (
              loadingDetail ? (
                <div className="flex justify-center py-12">
                  <Spinner size="lg" />
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-text-muted">
                  Select a course blueprint to edit its course package.
                </div>
              )
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <PageHeading
                    title={meta.title || 'Untitled Course Blueprint'}
                    description={`${[meta.subject, meta.grade_level, meta.course_code].filter(Boolean).join(' • ') || 'Course Blueprint'} • ${repositoryManaged ? 'Repository-managed' : 'Pika-managed'}`}
                  />
                  <div className="flex items-center gap-1 text-xs text-text-muted">
                    <span>Blueprint</span>
                    <SaveStatus
                      status={saving ? 'saving' : hasUnsavedChanges ? 'unsaved' : 'saved'}
                      title={hasUnsavedChanges ? `Unsaved sections: ${dirtySectionSummary}` : undefined}
                    />
                  </div>
                </div>

                <Tabs
                  ariaLabel="Blueprint workspace"
                  items={WORKSPACE_TABS}
                  value={activeWorkspace}
                  onValueChange={(workspace) => setActiveTab(WORKSPACE_SECTIONS[workspace][0])}
                  getTabId={(workspace) => `blueprint-${workspace}-tab`}
                  getPanelId={(workspace) => `blueprint-${workspace}-panel`}
                />
                <TabPanel
                  id={`blueprint-${activeWorkspace}-panel`}
                  labelledBy={`blueprint-${activeWorkspace}-tab`}
                  className="space-y-5"
                >
                  {activeWorkspace === 'overview' && counts ? (
                    <div className="rounded-card border border-border bg-surface-2 px-4 py-3 text-sm text-text-muted">
                      {counts.assignments} assignments • {counts.tests} tests • {counts.materials} materials • {counts.surveys} surveys • {counts.lesson_templates} lesson templates
                    </div>
                  ) : null}
                  {WORKSPACE_SECTIONS[activeWorkspace].length > 1 ? (
                    <Tabs
                      ariaLabel={`${WORKSPACE_TABS.find((item) => item.value === activeWorkspace)?.label} sections`}
                      items={WORKSPACE_SECTIONS[activeWorkspace].map((tab) => ({
                        value: tab,
                        label: tab === 'proposals' && actionableProposalCount > 0
                          ? `Proposals (${actionableProposalCount})`
                          : TAB_LABELS[tab],
                      }))}
                      value={activeTab}
                      onValueChange={setActiveTab}
                      getTabId={(tab) => `blueprint-${tab}-section-tab`}
                      getPanelId={(tab) => `blueprint-${tab}-section-panel`}
                    />
                  ) : null}
                  <div
                    id={`blueprint-${activeTab}-section-panel`}
                    role={WORKSPACE_SECTIONS[activeWorkspace].length > 1 ? 'tabpanel' : undefined}
                    aria-labelledby={WORKSPACE_SECTIONS[activeWorkspace].length > 1
                      ? `blueprint-${activeTab}-section-tab`
                      : undefined}
                  >
                {activeTab === 'details' ? (
                  <div className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <FormField label="Title">
                      <Input disabled={editorWriteLocked || repositoryManaged} value={meta.title} onChange={(e) => setMeta((current) => ({ ...current, title: e.target.value }))} />
                    </FormField>
                    <FormField label="Subject">
                      <Input disabled={editorWriteLocked || repositoryManaged} value={meta.subject} onChange={(e) => setMeta((current) => ({ ...current, subject: e.target.value }))} />
                    </FormField>
                    <FormField label="Grade Level">
                      <Input disabled={editorWriteLocked || repositoryManaged} value={meta.grade_level} onChange={(e) => setMeta((current) => ({ ...current, grade_level: e.target.value }))} />
                    </FormField>
                    <FormField label="Course Code">
                      <Input disabled={editorWriteLocked || repositoryManaged} value={meta.course_code} onChange={(e) => setMeta((current) => ({ ...current, course_code: e.target.value }))} />
                    </FormField>
                    <FormField label="Term Template">
                      <Input disabled={editorWriteLocked || repositoryManaged} value={meta.term_template} onChange={(e) => setMeta((current) => ({ ...current, term_template: e.target.value }))} />
                    </FormField>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="secondary" onClick={saveMetadata} disabled={editorWriteLocked || repositoryManaged}>
                      Save Details
                    </Button>
                  </div>

                  <div className="rounded-card border border-border bg-surface-2 p-4">
                    <div className="text-sm font-semibold text-text-default">Course Blueprint</div>
                    <div className="mt-1 text-sm text-text-muted">
                      {repositoryManaged
                        ? 'This Draft is read-only in Pika. Pull it to the repository, then review proposed changes here.'
                        : 'Edit the plan here, use it to create a classroom, or export a portable course package.'}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2">
                      <div>
                        <div className="text-sm font-medium text-text-default">
                          {repositoryManaged ? 'Repository-managed' : 'Pika-managed'}
                        </div>
                        <div className="mt-0.5 text-xs text-text-muted">
                          Only the selected authority may originate changes. Draft revision {detail.content_revision}
                          {' • '}
                          {detail.latest_version_number
                            ? `latest saved Version ${detail.latest_version_number}`
                            : 'no saved Version yet'}.
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => requestDiscardingAction(
                          changeAuthorityMode,
                          repositoryManaged ? 'Use Pika as the editor?' : 'Use the repository as the editor?',
                          'Discard and change editor',
                        )}
                        disabled={editorWriteLocked}
                      >
                        {repositoryManaged ? 'Use Pika as Editor' : 'Use Repository as Editor'}
                      </Button>
                    </div>
                    <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-sm">
                      <div className="font-medium text-text-default">Portable Course Package</div>
                      <div className="mt-1 text-text-muted">
                        Exports a .course-package.tar file with manifest.json and editable Markdown files.
                      </div>
                    </div>
                  </div>

                  </div>
                ) : activeTab === 'guidance' ? (
                  <BlueprintAuthoringGuidanceEditor
                    guidance={guidance}
                    savedGuidance={savedEditorState?.guidance ?? EMPTY_COURSE_BLUEPRINT_AUTHORING_GUIDANCE}
                    onChange={setGuidance}
                    onSave={saveGuidance}
                    onTryDraft={(target, unitExceptionId) => {
                      setAiTarget(target)
                      setAiUnitExceptionId(unitExceptionId || '')
                      setActiveTab('copilot')
                      void runCopilot(target, guidance, unitExceptionId || '')
                    }}
                    revision={detail.content_revision}
                    readOnly={repositoryManaged}
                    busy={editorWriteLocked}
                    dirty={dirtySections.includes('guidance')}
                    history={guidanceHistory}
                    historyLoading={guidanceHistoryLoading}
                    historyError={guidanceHistoryError}
                  />
                ) : activeTab === 'proposals' ? (

                  <div className="space-y-4">
                    <div className="rounded-card border border-border bg-surface-2 p-4">
                      <div className="text-sm font-semibold text-text-default">
                        Review Blueprint Proposals
                      </div>
                      <div className="mt-1 text-sm text-text-muted">
                        Repository, package, classroom, and AI changes remain separate until you review and apply them here.
                      </div>
                    </div>

                    {proposalsError ? (
                      <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
                        {proposalsError}
                      </div>
                    ) : null}

                    {proposalsLoading ? (
                      <div className="flex justify-center py-8">
                        <Spinner />
                      </div>
                    ) : proposals.length === 0 ? (
                      <div className="rounded-card border border-border bg-surface-2 p-4 text-sm text-text-muted">
                        No change proposals. Pull the current course package before editing it in a repository.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {proposals.map((proposal) => {
                          const summary = proposal.diff_json.summary || {}
                          const summaryParts = [
                            summary.add ? `${summary.add} added` : '',
                            summary.update ? `${summary.update} updated` : '',
                            summary.move ? `${summary.move} moved` : '',
                            summary.archive ? `${summary.archive} archived` : '',
                            summary.singleton ? `${summary.singleton} course sections` : '',
                          ].filter(Boolean)
                          const canApply = proposal.status === 'needs_review'
                            || proposal.status === 'ready'
                          return (
                            <div
                              key={proposal.id}
                              className="rounded-card border border-border bg-surface p-4"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-semibold text-text-default">
                                      {proposal.target_kind === 'classroom'
                                        ? `Blueprint Version → ${
                                            detail.linked_classrooms.find(
                                              (classroom) =>
                                                classroom.id === proposal.target_classroom_id,
                                            )?.title || 'classroom'
                                          }`
                                        : proposal.source_kind === 'repository'
                                        ? 'Repository changes'
                                        : `${proposal.source_kind} changes`}
                                    </div>
                                    <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-muted">
                                      {proposal.status.replace('_', ' ')}
                                    </span>
                                  </div>
                                  <div className="mt-1 text-sm text-text-muted">
                                    {summaryParts.join(' • ') || 'No reusable content changes'}
                                    {' • '}
                                    based on Blueprint revision {proposal.base_blueprint_revision}
                                    {proposal.base_classroom_revision
                                      ? ` and classroom revision ${proposal.base_classroom_revision}`
                                      : ''}
                                  </div>
                                  {proposal.diff_json.guidance_provenance ? (
                                    <details className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
                                      <summary className="cursor-pointer font-medium text-text-default">
                                        Draft guidance · revision {proposal.diff_json.guidance_provenance.blueprint_revision}
                                        {proposal.diff_json.guidance_provenance.unit_label
                                          ? ` · ${proposal.diff_json.guidance_provenance.unit_label}`
                                          : ' · course rules'}
                                      </summary>
                                      <pre className="mt-2 whitespace-pre-wrap font-sans text-xs">
                                        {proposal.diff_json.guidance_provenance.rules_markdown || 'No guidance saved at drafting time.'}
                                      </pre>
                                    </details>
                                  ) : null}
                                  {proposal.status === 'stale' ? (
                                    <div className="mt-2 text-sm text-warning">
                                      {proposal.target_kind === 'classroom'
                                        ? 'The classroom changed after this update was prepared. Review it again before applying.'
                                        : 'The Blueprint changed after this package was pulled. Pull it again before proposing updates.'}
                                    </div>
                                  ) : null}
                                  {proposal.operations_json?.length ? (
                                    <div className="mt-3 space-y-1.5">
                                      {proposal.operations_json.map((operation, index) => {
                                        const label = operation.key
                                          || operation.after?.title
                                          || operation.before?.title
                                          || operation.artifact_id?.slice(0, 8)
                                          || 'course structure'
                                        const area = operation.collection
                                          ? operation.collection.replaceAll('_', ' ')
                                          : 'course'
                                        return (
                                          <div
                                            key={`${operation.action}:${operation.artifact_id || operation.key || index}:${index}`}
                                            className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text-muted"
                                          >
                                            <span className="font-medium capitalize text-text-default">
                                              {operation.action}
                                            </span>
                                            {' '}
                                            {area}: {label}
                                            {operation.action === 'move'
                                              ? ` (${operation.from_position} → ${operation.to_position})`
                                              : ''}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  ) : null}
                                </div>
                                {canApply ? (
                                  <Button
                                    type="button"
                                    onClick={() => requestDiscardingAction(
                                      () => applyProposal(proposal.id),
                                      'Apply this proposal?',
                                      'Discard and apply',
                                    )}
                                    disabled={applyingProposalId !== null}
                                  >
                                    {applyingProposalId === proposal.id
                                      ? 'Applying...'
                                      : proposal.target_kind === 'classroom'
                                        ? 'Apply to Classroom'
                                        : 'Apply Proposal'}
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ) : activeTab === 'publish' ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr),auto]">
                      <FormField label="Planned Course Site Slug" hint="Leave blank to keep the planned site private.">
                        <Input
                          value={plannedSite.slug}
                          onChange={(e) =>
                            setPlannedSite((current) => ({ ...current, slug: slugifyCourseSiteValue(e.target.value) }))
                          }
                          placeholder="computer-science-11"
                          disabled={editorWriteLocked || repositoryManaged}
                        />
                      </FormField>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            setPlannedSite((current) => ({
                              ...current,
                              slug: slugifyCourseSiteValue(meta.title || detail.title),
                            }))
                          }
                          disabled={editorWriteLocked || repositoryManaged}
                        >
                          Generate From Title
                        </Button>
                      </div>
                    </div>

                    <label className="flex items-center gap-3 rounded-card border border-border bg-surface-2 px-4 py-3 text-sm text-text-default">
                      <input
                        type="checkbox"
                        checked={plannedSite.published}
                        onChange={(e) =>
                          setPlannedSite((current) => ({ ...current, published: e.target.checked }))
                        }
                        disabled={editorWriteLocked || repositoryManaged}
                        className="h-4 w-4"
                      />
                        Publish this planned course site
                    </label>

                    <div className="rounded-card border border-border bg-surface-2 p-4">
                      <div className="text-sm font-semibold text-text-default">Published Sections</div>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {PLANNED_SITE_CONFIG_OPTIONS.map(
                          ([key, label]) => (
                            <label key={key} className="flex items-center gap-3 text-sm text-text-default">
                              <input
                                type="checkbox"
                                checked={plannedSite.config[key]}
                                onChange={(e) =>
                                  setPlannedSite((current) => ({
                                    ...current,
                                    config: normalizePlannedCourseSiteConfig({ ...current.config, [key]: e.target.checked }),
                                  }))
                                }
                                disabled={editorWriteLocked || repositoryManaged}
                                className="h-4 w-4"
                              />
                              {label}
                            </label>
                          )
                        )}
                      </div>
                    </div>

                    {plannedSite.published && plannedSite.slug ? (
                      <div className="rounded-card border border-border bg-surface-2 p-4 text-sm text-text-muted">
                        Planned course site: <a className="text-primary underline" href={`/planned/${plannedSite.slug}`} target="_blank" rel="noreferrer">{`/planned/${plannedSite.slug}`}</a>
                      </div>
                    ) : null}

                    <div className="flex justify-end">
                      <Button type="button" onClick={savePlannedSite} disabled={editorWriteLocked || repositoryManaged}>
                        {saving ? 'Saving...' : 'Save Planned Site'}
                      </Button>
                    </div>
                  </div>
                ) : activeTab === 'sync' ? (
                  <div className="space-y-4">
                    {detail.linked_classrooms.length === 0 ? (
                      <div className="rounded-card border border-border bg-surface-2 p-4 text-sm text-text-muted">
                        No classrooms have been created from this blueprint yet.
                      </div>
                    ) : (
                      <>
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr),auto]">
                          <FormField label="Classroom" hint="Compare reusable course structure in either direction. Every change remains a reviewable proposal.">
                            <select
                              value={mergeClassroomId}
                              onChange={(e) => {
                                mergeSuggestionsRequestIdRef.current += 1
                                setMergeClassroomId(e.target.value)
                                setMergeSuggestions(null)
                                setMergeSelection({})
                                setMergeLoading(false)
                              }}
                              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                              {detail.linked_classrooms.map((classroom) => (
                                <option key={classroom.id} value={classroom.id}>
                                  {classroom.title}
                                </option>
                              ))}
                            </select>
                          </FormField>
                          <div className="flex flex-wrap items-end gap-2">
                            <Button
                              type="button"
                              onClick={() => requestSavedVersionAction(
                                prepareClassroomProposal,
                                'Update the Classroom from the saved Blueprint?',
                                'Use saved version',
                              )}
                              disabled={editorWriteLocked || !mergeClassroomId}
                            >
                              {classroomProposalPreparing
                                ? 'Preparing...'
                                : 'Update Classroom from Blueprint'}
                            </Button>
                            <Button type="button" variant="secondary" onClick={() => loadMergeSuggestions()} disabled={mergeLoading || !mergeClassroomId}>
                              {mergeLoading ? 'Reviewing...' : 'Save Classroom Changes to Blueprint'}
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-card border border-border bg-surface-2 p-4 text-sm text-text-muted">
                          Updating a classroom never imports release controls or student data. Save new classroom artifacts to the Blueprint first. New Blueprint work arrives as drafts; assignments with student work and tests or surveys with responses keep their historical version and receive a new draft successor.
                        </div>

                        {mergeSuggestions ? (
                          <div className="space-y-4">
                            {mergeSuggestions.suggestions.length === 0 ? (
                              <div className="rounded-card border border-border bg-surface-2 p-4 text-sm text-text-muted">
                                No classroom changes to save for this course blueprint.
                              </div>
                            ) : (
                              <>
                                {mergeSuggestions.suggestions.map((suggestion) => (
                                  <div key={suggestion.area} className="rounded-card border border-border bg-surface-2 p-4">
                                    <label className="flex items-start gap-3">
                                      <input
                                        type="checkbox"
                                        checked={!!mergeSelection[suggestion.area]}
                                        onChange={(e) =>
                                          setMergeSelection((current) => ({
                                            ...current,
                                            [suggestion.area]: e.target.checked,
                                          }))
                                        }
                                        className="mt-1 h-4 w-4"
                                      />
                                      <div className="min-w-0">
                                        <div className="text-sm font-semibold text-text-default">{suggestion.title}</div>
                                        <div className="mt-1 text-sm text-text-muted">{suggestion.summary}</div>
                                      </div>
                                    </label>
                                    <div className="mt-3 space-y-2">
                                      {suggestion.items.map((item) => (
                                        <div key={`${suggestion.area}:${item.key}`} className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
                                          <div className="font-medium text-text-default">
                                            {item.label} • {item.operation}
                                          </div>
                                          <div className="mt-1 text-text-muted">Current blueprint: {item.current_summary}</div>
                                          <div className="text-text-muted">Classroom version: {item.proposed_summary}</div>
                                        </div>
                                      ))}
                                    </div>
                                    {showMarkdown && suggestion.preview_markdown ? (
                                      <textarea
                                        readOnly
                                        value={suggestion.preview_markdown}
                                        className="mt-3 min-h-[140px] w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-text-default"
                                      />
                                    ) : null}
                                  </div>
                                ))}

                                <div className="flex justify-end">
                                  <Button type="button" onClick={applyMergeSuggestions} disabled={mergeApplying || repositoryManaged}>
                                    {mergeApplying ? 'Saving...' : 'Save Selected Updates'}
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : activeTab === 'copilot' ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-[220px,minmax(0,1fr)]">
                      <FormField label="Draft Section">
                        <select
                          value={aiTarget}
                          onChange={(e) => {
                            setAiTarget(e.target.value as CopilotTarget)
                            setAiPreview(null)
                          }}
                          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="overview">Overview</option>
                          <option value="outline">Outline</option>
                          <option value="resources">Resources</option>
                          <option value="assignments">Assignments</option>
                          <option value="tests">Tests</option>
                          <option value="lesson-plans">Lesson Plans</option>
                          <option value="materials">Materials</option>
                          <option value="surveys">Surveys</option>
                          <option value="grading">Grading</option>
                        </select>
                      </FormField>
                      <FormField label="Direction">
                        <Input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="Focus on a coding-heavy semester with weekly checkpoints." />
                      </FormField>
                    </div>

                    {aiTarget === 'assignments' || aiTarget === 'tests' ? (
                      <div className="rounded-card border border-border bg-surface-2 p-4 space-y-3">
                        <p className="text-sm text-text-muted">
                          Draft previews use the selected Authoring Guidance. Review and edit the result before proposing it.
                        </p>
                        <FormField label="Unit guidance">
                          <Select
                            value={aiUnitExceptionId}
                            onChange={(event) => {
                              setAiUnitExceptionId(event.target.value)
                              setAiPreview(null)
                            }}
                            className="max-w-sm"
                            options={[
                              { value: '', label: 'Course rules only' },
                              ...(detail?.authoring_guidance?.unit_exceptions.map((unit) => ({
                                value: unit.id,
                                label: unit.unit_label,
                              })) ?? []),
                            ]}
                          />
                        </FormField>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      <Button type="button" onClick={() => runCopilot('analyze')} disabled={aiBusy}>
                        {aiBusy ? 'Working...' : 'Review Course Blueprint'}
                      </Button>
                        <Button type="button" variant="secondary" onClick={() => runCopilot(aiTarget)} disabled={aiBusy}>
                          Draft Preview
                        </Button>
                      {aiPreview ? (
                        <Button type="button" variant="secondary" onClick={applyCopilotPreview} disabled={aiBusy || repositoryManaged || aiPreview.guidance?.trial}>
                          Propose Change
                        </Button>
                      ) : null}
                    </div>

                    {aiAnalysis ? (
                      <div className="rounded-card border border-border bg-surface-2 p-4">
                        <div className="text-sm font-semibold text-text-default">Completeness Review</div>
                        <div className="mt-2 text-sm text-text-muted">
                          Missing: {aiAnalysis.missing?.length ? aiAnalysis.missing.join(', ') : 'nothing obvious'}
                        </div>
                        <div className="mt-2 space-y-1 text-sm text-text-muted">
                          {(aiAnalysis.suggestions || []).map((suggestion: string) => (
                            <div key={suggestion}>- {suggestion}</div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {aiPreview && showMarkdown ? (
                      <div className="space-y-2">
                        <div className="text-sm font-semibold text-text-default">Preview: {TAB_LABELS[aiPreview.target]}</div>
                        {aiPreview.guidance?.trial ? (
                          <p className="text-sm text-text-muted">Trial preview using unsaved guidance. Apply the guidance, then generate a new preview before proposing the content.</p>
                        ) : null}
                        {aiPreview.guidance ? (
                          <details className="rounded-card border border-border bg-surface-2 p-3 text-sm text-text-muted">
                            <summary className="cursor-pointer text-text-default">
                              {aiPreview.guidance.trial ? 'Trial guidance' : 'Guidance used'}: Blueprint revision {aiPreview.guidance.blueprint_revision}
                              {aiPreview.guidance.unit_label ? ` · ${aiPreview.guidance.unit_label}` : ' · course rules'}
                            </summary>
                            <pre className="mt-3 whitespace-pre-wrap font-sans text-sm">{aiPreview.guidance.rules_markdown || 'No guidance saved yet.'}</pre>
                          </details>
                        ) : null}
                        <textarea
                          aria-label="Draft preview Markdown"
                          value={aiPreview.content}
                          onChange={(e) => setAiPreview((current) => (current ? { ...current, content: e.target.value } : current))}
                          className="min-h-[420px] w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    ) : aiPreview ? (
                      <div className="rounded-card border border-border bg-surface-2 p-4 text-sm text-text-muted">
                        Markdown preview is hidden by your display setting.
                      </div>
                    ) : null}
                  </div>
                ) : activeTab === 'grading' ? (
                  <div className="space-y-4">
                    <div className="rounded-card border border-border bg-surface-2 p-4">
                      <div className="text-sm font-semibold text-text-default">
                        Reusable Gradebook Setup
                      </div>
                      <div className="mt-1 text-sm text-text-muted">
                        These defaults travel with the Blueprint. Student scores, overrides, and report cards remain in each classroom.
                      </div>
                    </div>
                    <label className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 text-sm text-text-default">
                      <input
                        type="checkbox"
                        checked={grading.use_weights}
                        onChange={(event) => setGrading((current) => ({
                          ...current,
                          use_weights: event.target.checked,
                        }))}
                        disabled={editorWriteLocked || repositoryManaged}
                        className="h-4 w-4"
                      />
                      Weight assignments and tests by category
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField label="Assignments Weight (%)">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={grading.assignments_weight}
                          onChange={(event) => setGrading((current) => ({
                            ...current,
                            assignments_weight: Number(event.target.value),
                          }))}
                          disabled={editorWriteLocked || repositoryManaged}
                        />
                      </FormField>
                      <FormField label="Tests Weight (%)">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={grading.tests_weight}
                          onChange={(event) => setGrading((current) => ({
                            ...current,
                            tests_weight: Number(event.target.value),
                          }))}
                          disabled={editorWriteLocked || repositoryManaged}
                        />
                      </FormField>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface-2 px-4 py-3 text-sm">
                      <span className="text-text-muted">
                        Category total
                      </span>
                      <span className={
                        !grading.use_weights
                        || grading.assignments_weight + grading.tests_weight === 100
                          ? 'font-semibold text-text-default'
                          : 'font-semibold text-danger'
                      }>
                        {grading.assignments_weight + grading.tests_weight}%
                      </span>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={saveCurrentTab}
                        disabled={editorWriteLocked || repositoryManaged}
                      >
                        {saving ? 'Saving...' : 'Save Grading'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  showMarkdown ? (
                    <div className="space-y-3">
                      {activeTab === 'assignments'
                      || activeTab === 'materials'
                      || activeTab === 'surveys' ? (
                        <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
                          Classwork Position is shared across assignments, materials, and surveys so their classroom order stays portable.
                        </div>
                      ) : null}
                      <textarea
                        value={drafts[activeTab as MarkdownEditorTab]}
                        aria-label={`${TAB_LABELS[activeTab]} Markdown`}
                        onChange={(e) => setDrafts((current) => ({ ...current, [activeTab]: e.target.value }))}
                        disabled={editorWriteLocked || repositoryManaged}
                        className="min-h-[520px] w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <div className="flex justify-end">
                        <Button type="button" onClick={saveCurrentTab} disabled={editorWriteLocked || repositoryManaged}>
                          {saving ? 'Saving...' : `Save ${TAB_LABELS[activeTab]}`}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-card border border-border bg-surface-2 p-4 text-sm text-text-muted">
                      Markdown editing is hidden by your display setting.
                    </div>
                  )
                )}
                  </div>
                </TabPanel>
              </div>
            )}
          </section>
        </div>
      </PageContent>

      <CreateBlueprintModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={async (blueprint) => {
          setShowCreate(false)
          invalidateTeacherBlueprints()
          await loadBlueprints(blueprint.id)
        }}
      />

      <CreateClassroomModal
        isOpen={showCreateClassroom}
        onClose={() => setShowCreateClassroom(false)}
        initialBlueprintId={selectedBlueprintId}
        onSuccess={(classroom) => {
          setShowCreateClassroom(false)
          router.push(`/classrooms/${classroom.id}?tab=daily`)
        }}
      />

      {deleteTarget ? (
        <CourseBlueprintPurgeDialog
          courseBlueprintId={deleteTarget.id}
          courseBlueprintTitle={deleteTarget.title}
          isOpen
          onClose={() => setDeleteTarget(null)}
          onCompleted={handleBlueprintPurgeCompleted}
        />
      ) : null}

      <ConfirmDialog
        isOpen={pendingUnsavedAction !== null}
        title={pendingUnsavedAction?.title || 'Continue?'}
        description={pendingUnsavedAction?.description}
        confirmLabel={pendingUnsavedAction?.confirmLabel || 'Continue'}
        cancelLabel="Keep editing"
        confirmVariant={pendingUnsavedAction?.destructive ? 'danger' : 'default'}
        onCancel={() => setPendingUnsavedAction(null)}
        onConfirm={() => {
          const action = pendingUnsavedAction?.onConfirm
          setPendingUnsavedAction(null)
          return action?.()
        }}
      />
    </PageLayout>
  )
}
