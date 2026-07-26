'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, FormField, Input } from '@/ui'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import { Spinner } from '@/components/Spinner'
import { CreateBlueprintModal } from '@/components/CreateBlueprintModal'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import { useMarkdownPreference } from '@/contexts/MarkdownPreferenceContext'
import {
  courseBlueprintAssignmentsToMarkdown,
  markdownToCourseBlueprintAssignments,
} from '@/lib/course-blueprint-assignments'
import {
  courseBlueprintAssessmentsToMarkdown,
  markdownToCourseBlueprintAssessments,
} from '@/lib/course-blueprint-assessments-markdown'
import {
  courseBlueprintLessonTemplatesToMarkdown,
  markdownToCourseBlueprintLessonTemplates,
} from '@/lib/course-blueprint-lesson-templates'
import {
  courseBlueprintMaterialsToMarkdown,
  markdownToCourseBlueprintMaterials,
} from '@/lib/course-blueprint-materials'
import {
  courseBlueprintSurveysToMarkdown,
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
import type {
  BlueprintMergeSuggestionSet,
  CourseBlueprint,
  CourseBlueprintDetail,
  PlannedCourseSiteConfig,
} from '@/types'

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
}

const VISIBLE_EDITOR_TABS = Object.keys(TAB_LABELS) as EditorTab[]

const PLANNED_SITE_CONFIG_OPTIONS: Array<[keyof PlannedCourseSiteConfig, string]> = [
  ['overview', 'overview'],
  ['outline', 'outline'],
  ['resources', 'resources'],
  ['assignments', 'assignments'],
  ['tests', 'tests'],
  ['lesson_plans', 'lesson plans'],
]

function visiblePlannedSiteConfig(config: PlannedCourseSiteConfig | null | undefined): PlannedCourseSiteConfig {
  return {
    ...(config || DEFAULT_PLANNED_COURSE_SITE_CONFIG),
  }
}

type MarkdownEditorTab = Exclude<
  EditorTab,
  'copilot' | 'publish' | 'sync' | 'proposals' | 'grading'
>

type DraftState = Record<MarkdownEditorTab, string>

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
  }
  created_at: string
}

function emptyDraftState(): DraftState {
  return {
    overview: '',
    outline: '',
    resources: '',
    assignments: '',
    tests: '',
    'lesson-plans': '',
    materials: '',
    surveys: '',
  }
}

export default function TeacherBlueprintsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { showMarkdown } = useMarkdownPreference()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [blueprints, setBlueprints] = useState<CourseBlueprint[]>([])
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CourseBlueprintDetail | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showCreateClassroom, setShowCreateClassroom] = useState(false)
  const [activeTab, setActiveTab] = useState<EditorTab>('overview')
  const [drafts, setDrafts] = useState<DraftState>(emptyDraftState())
  const [meta, setMeta] = useState({
    title: '',
    subject: '',
    grade_level: '',
    course_code: '',
    term_template: '',
  })
  const [error, setError] = useState('')
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
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiTarget, setAiTarget] = useState<CopilotTarget>('overview')
  const [aiPreview, setAiPreview] = useState<{ target: CopilotTarget; content: string } | null>(null)
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
  const detailRequestIdRef = useRef(0)
  const selectedBlueprintIdRef = useRef<string | null>(null)
  selectedBlueprintIdRef.current = selectedBlueprintId
  const preferredBlueprintId = searchParams.get('blueprint')
  const fromClassroomId = searchParams.get('fromClassroom')

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

  async function loadBlueprints(preferredId?: string) {
    setLoadingList(true)
    setError('')
    try {
      const nextBlueprints = await fetchTeacherBlueprints()
      setBlueprints(nextBlueprints)
      setSelectedBlueprintId((current) => preferredId || current || nextBlueprints[0]?.id || null)
    } catch (err: any) {
      setError(err.message || 'Failed to load course blueprints')
    } finally {
      setLoadingList(false)
    }
  }

  async function loadDetail(id: string) {
    const requestId = detailRequestIdRef.current + 1
    detailRequestIdRef.current = requestId
    setLoadingDetail(true)
    setError('')
    try {
      const blueprint = await fetchTeacherBlueprintDetail(id)
      if (detailRequestIdRef.current !== requestId || selectedBlueprintIdRef.current !== id) return
      setDetail(blueprint)
      setMeta({
        title: blueprint.title,
        subject: blueprint.subject,
        grade_level: blueprint.grade_level,
        course_code: blueprint.course_code,
        term_template: blueprint.term_template,
      })
      setPlannedSite({
        slug: blueprint.planned_site_slug || '',
        published: blueprint.planned_site_published,
        config: visiblePlannedSiteConfig(blueprint.planned_site_config),
      })
      setGrading({
        use_weights: blueprint.gradebook_use_weights ?? false,
        assignments_weight: blueprint.gradebook_assignments_weight ?? 70,
        tests_weight: blueprint.gradebook_tests_weight ?? 30,
      })
      setDrafts({
        overview: blueprint.overview_markdown || '',
        outline: blueprint.outline_markdown || '',
        resources: blueprint.resources_markdown || '',
        assignments: courseBlueprintAssignmentsToMarkdown(blueprint.assignments),
        tests: courseBlueprintAssessmentsToMarkdown(blueprint.assessments as any, 'test'),
        'lesson-plans': courseBlueprintLessonTemplatesToMarkdown(blueprint.lesson_templates),
        materials: courseBlueprintMaterialsToMarkdown(blueprint.materials || []),
        surveys: courseBlueprintSurveysToMarkdown(blueprint.surveys || []),
      })
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
  }

  async function loadProposals(id: string) {
    setProposalsLoading(true)
    setProposalsError('')
    try {
      const response = await fetch(`/api/teacher/course-blueprints/${id}/proposals`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load Blueprint proposals')
      if (selectedBlueprintIdRef.current !== id) return
      setProposals(data.proposals || [])
    } catch (err: any) {
      if (selectedBlueprintIdRef.current !== id) return
      setProposals([])
      setProposalsError(err.message || 'Failed to load Blueprint proposals')
    } finally {
      if (selectedBlueprintIdRef.current === id) setProposalsLoading(false)
    }
  }

  useEffect(() => {
    loadBlueprints(preferredBlueprintId || undefined)
  }, [preferredBlueprintId])

  useEffect(() => {
    if (!selectedBlueprintId) {
      detailRequestIdRef.current += 1
      setDetail(null)
      setProposals([])
      return
    }
    loadDetail(selectedBlueprintId)
    loadProposals(selectedBlueprintId)
  }, [selectedBlueprintId])

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
    setClassroomProposalPreparing(true)
    setProposalsError('')
    try {
      const response = await fetch(
        `/api/teacher/course-blueprints/${selectedBlueprintId}/proposals/classrooms`,
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
      setActiveTab('proposals')
      await loadProposals(selectedBlueprintId)
    } catch (err: any) {
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
      await loadBlueprints(selectedBlueprintId)
      await loadDetail(selectedBlueprintId)
    } catch (err: any) {
      setError(err.message || 'Failed to save metadata')
    } finally {
      setSaving(false)
    }
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
        loadBlueprints(selectedBlueprintId),
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
      await loadBlueprints(selectedBlueprintId)
      await loadDetail(selectedBlueprintId)
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
          planned_site_config: visiblePlannedSiteConfig(plannedSite.config),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save planned site settings')
      }
      invalidateTeacherBlueprints()
      await loadBlueprints(selectedBlueprintId)
      await loadDetail(selectedBlueprintId)
    } catch (err: any) {
      setError(err.message || 'Failed to save planned site settings')
    } finally {
      setSaving(false)
    }
  }

  async function loadMergeSuggestions(classroomId = mergeClassroomId) {
    if (!selectedBlueprintId || !classroomId) return
    setMergeLoading(true)
    setError('')
    try {
      const response = await fetch(
        `/api/teacher/course-blueprints/${selectedBlueprintId}/merge-suggestions?classroomId=${encodeURIComponent(classroomId)}`
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load merge suggestions')
      }
      const suggestionSet = data.suggestion_set as BlueprintMergeSuggestionSet
      setMergeSuggestions(suggestionSet)
      setMergeSelection(
        Object.fromEntries(suggestionSet.suggestions.map((suggestion) => [suggestion.area, true]))
      )
    } catch (err: any) {
      setError(err.message || 'Failed to load merge suggestions')
    } finally {
      setMergeLoading(false)
    }
  }

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
    setError('')
    try {
      const isJsonBundle = file.name.toLowerCase().endsWith('.json')
      const response = isJsonBundle
        ? await (async () => {
            const text = await file.text()
            const bundle = JSON.parse(text)
            return fetch('/api/teacher/course-blueprints/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(bundle),
            })
          })()
        : await fetch('/api/teacher/course-blueprints/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-tar' },
            body: await file.arrayBuffer(),
          })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.errors?.join('\n') || data.error || 'Failed to import course package')
      }
      invalidateTeacherBlueprints()
      await loadBlueprints(data.blueprint.id)
    } catch (err: any) {
      setError(err.message || 'Failed to import course package')
    } finally {
      if (event.target) event.target.value = ''
    }
  }

  async function runCopilot(target: CopilotTarget | 'analyze') {
    if (!selectedBlueprintId) return
    setAiBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}/ai/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, prompt: aiPrompt }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate copilot suggestion')
      }
      setAiAnalysis(data.suggestion.analysis || null)
      if (target !== 'analyze') {
        setAiPreview({ target, content: data.suggestion.content || '' })
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
          { id: 'back-classrooms', label: 'Classrooms', onSelect: () => router.push('/classrooms') },
          { id: 'new-blueprint', label: 'New Course Blueprint', onSelect: () => setShowCreate(true) },
          { id: 'import-package', label: 'Import Course Package', onSelect: () => importInputRef.current?.click() },
          ...(selectedBlueprintId
            ? [
                { id: 'create-classroom', label: 'Use for Classroom', primary: true, onSelect: () => setShowCreateClassroom(true) },
                { id: 'export-package', label: 'Export Course Package', onSelect: handleExport },
                ...(plannedSite.published && plannedSite.slug
                  ? [{ id: 'open-planned-site', label: 'Open Planned Site', onSelect: () => window.open(`/planned/${plannedSite.slug}`, '_blank') }]
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
                    onClick={() => setSelectedBlueprintId(blueprint.id)}
                    className={`w-full rounded-card border px-3 py-3 text-left transition-colors ${
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
            {!selectedBlueprintId || !detail ? (
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
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <FormField label="Title">
                    <Input disabled={repositoryManaged} value={meta.title} onChange={(e) => setMeta((current) => ({ ...current, title: e.target.value }))} />
                  </FormField>
                  <FormField label="Subject">
                    <Input disabled={repositoryManaged} value={meta.subject} onChange={(e) => setMeta((current) => ({ ...current, subject: e.target.value }))} />
                  </FormField>
                  <FormField label="Grade Level">
                    <Input disabled={repositoryManaged} value={meta.grade_level} onChange={(e) => setMeta((current) => ({ ...current, grade_level: e.target.value }))} />
                  </FormField>
                  <FormField label="Course Code">
                    <Input disabled={repositoryManaged} value={meta.course_code} onChange={(e) => setMeta((current) => ({ ...current, course_code: e.target.value }))} />
                  </FormField>
                  <FormField label="Term Template">
                    <Input disabled={repositoryManaged} value={meta.term_template} onChange={(e) => setMeta((current) => ({ ...current, term_template: e.target.value }))} />
                  </FormField>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="secondary" onClick={saveMetadata} disabled={saving || repositoryManaged}>
                    Save Details
                  </Button>
                  {counts ? (
                    <div className="text-xs text-text-muted">
                      {counts.assignments} assignments • {counts.tests} tests • {counts.materials} materials • {counts.surveys} surveys • {counts.lesson_templates} lesson templates
                    </div>
                  ) : null}
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
                      onClick={changeAuthorityMode}
                      disabled={saving}
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

                <div className="flex flex-wrap gap-2">
                  {VISIBLE_EDITOR_TABS.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                        activeTab === tab
                          ? 'bg-primary-solid text-text-inverse'
                          : 'bg-surface-2 text-text-default hover:bg-surface-hover'
                      }`}
                    >
                        {tab === 'proposals' && actionableProposalCount > 0
                          ? `Proposals (${actionableProposalCount})`
                          : TAB_LABELS[tab]}
                    </button>
                  ))}
                </div>

                {activeTab === 'proposals' ? (
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
                                    onClick={() => applyProposal(proposal.id)}
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
                                    config: visiblePlannedSiteConfig({ ...current.config, [key]: e.target.checked }),
                                  }))
                                }
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
                      <Button type="button" onClick={savePlannedSite} disabled={saving || repositoryManaged}>
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
                                setMergeClassroomId(e.target.value)
                                setMergeSuggestions(null)
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
                              onClick={prepareClassroomProposal}
                              disabled={classroomProposalPreparing || !mergeClassroomId}
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
                          onChange={(e) => setAiTarget(e.target.value as CopilotTarget)}
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

                    <div className="flex flex-wrap gap-2">
                      <Button type="button" onClick={() => runCopilot('analyze')} disabled={aiBusy}>
                        {aiBusy ? 'Working...' : 'Review Course Blueprint'}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => runCopilot(aiTarget)} disabled={aiBusy}>
                        Draft Preview
                      </Button>
                      {aiPreview ? (
                        <Button type="button" variant="secondary" onClick={applyCopilotPreview} disabled={aiBusy || repositoryManaged}>
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
                        <textarea
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
                        disabled={repositoryManaged}
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
                          disabled={repositoryManaged}
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
                          disabled={repositoryManaged}
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
                        disabled={saving || repositoryManaged}
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
                        onChange={(e) => setDrafts((current) => ({ ...current, [activeTab]: e.target.value }))}
                        disabled={repositoryManaged}
                        className="min-h-[520px] w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <div className="flex justify-end">
                        <Button type="button" onClick={saveCurrentTab} disabled={saving || repositoryManaged}>
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
          router.push(`/classrooms/${classroom.id}?tab=attendance`)
        }}
      />
    </PageLayout>
  )
}
