'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, FormField, Input } from '@/ui'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import { Spinner } from '@/components/Spinner'
import { CreateBlueprintModal } from '@/components/CreateBlueprintModal'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
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
import type { CourseBlueprint, CourseBlueprintDetail } from '@/types'

type EditorTab =
  | 'overview'
  | 'outline'
  | 'resources'
  | 'assignments'
  | 'quizzes'
  | 'tests'
  | 'lesson-plans'
  | 'copilot'

const TAB_LABELS: Record<EditorTab, string> = {
  overview: 'Overview',
  outline: 'Outline',
  resources: 'Resources',
  assignments: 'Assignments',
  quizzes: 'Quizzes',
  tests: 'Tests',
  'lesson-plans': 'Lesson Plans',
  copilot: 'Copilot',
}

type DraftState = Record<Exclude<EditorTab, 'copilot'>, string>

function emptyDraftState(): DraftState {
  return {
    overview: '',
    outline: '',
    resources: '',
    assignments: '',
    quizzes: '',
    tests: '',
    'lesson-plans': '',
  }
}

export default function TeacherBlueprintsPage() {
  const router = useRouter()
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
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiTarget, setAiTarget] = useState<EditorTab>('overview')
  const [aiPreview, setAiPreview] = useState<{ target: EditorTab; content: string } | null>(null)
  const [aiAnalysis, setAiAnalysis] = useState<any>(null)
  const [aiBusy, setAiBusy] = useState(false)

  const counts = useMemo(() => {
    if (!detail) return null
    return {
      assignments: detail.assignments.length,
      quizzes: detail.assessments.filter((assessment) => assessment.assessment_type === 'quiz').length,
      tests: detail.assessments.filter((assessment) => assessment.assessment_type === 'test').length,
      lesson_templates: detail.lesson_templates.length,
    }
  }, [detail])

  async function loadBlueprints(preferredId?: string) {
    setLoadingList(true)
    setError('')
    try {
      const response = await fetch('/api/teacher/course-blueprints')
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load course blueprints')
      }
      const nextBlueprints = (data.blueprints || []) as CourseBlueprint[]
      setBlueprints(nextBlueprints)
      setSelectedBlueprintId((current) => preferredId || current || nextBlueprints[0]?.id || null)
    } catch (err: any) {
      setError(err.message || 'Failed to load course blueprints')
    } finally {
      setLoadingList(false)
    }
  }

  async function loadDetail(id: string) {
    setLoadingDetail(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/course-blueprints/${id}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load course blueprint')
      }
      const blueprint = data.blueprint as CourseBlueprintDetail
      setDetail(blueprint)
      setMeta({
        title: blueprint.title,
        subject: blueprint.subject,
        grade_level: blueprint.grade_level,
        course_code: blueprint.course_code,
        term_template: blueprint.term_template,
      })
      setDrafts({
        overview: blueprint.overview_markdown || '',
        outline: blueprint.outline_markdown || '',
        resources: blueprint.resources_markdown || '',
        assignments: courseBlueprintAssignmentsToMarkdown(blueprint.assignments),
        quizzes: courseBlueprintAssessmentsToMarkdown(blueprint.assessments as any, 'quiz'),
        tests: courseBlueprintAssessmentsToMarkdown(blueprint.assessments as any, 'test'),
        'lesson-plans': courseBlueprintLessonTemplatesToMarkdown(blueprint.lesson_templates),
      })
      setAiPreview(null)
      setAiAnalysis(null)
    } catch (err: any) {
      setError(err.message || 'Failed to load course blueprint')
    } finally {
      setLoadingDetail(false)
    }
  }

  useEffect(() => {
    loadBlueprints()
  }, [])

  useEffect(() => {
    if (!selectedBlueprintId) {
      setDetail(null)
      return
    }
    loadDetail(selectedBlueprintId)
  }, [selectedBlueprintId])

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
      await loadBlueprints(selectedBlueprintId)
      await loadDetail(selectedBlueprintId)
    } catch (err: any) {
      setError(err.message || 'Failed to save metadata')
    } finally {
      setSaving(false)
    }
  }

  async function saveCurrentTab() {
    if (!selectedBlueprintId || !detail || activeTab === 'copilot') return
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
      } else if (activeTab === 'quizzes' || activeTab === 'tests') {
        const parsed = markdownToCourseBlueprintAssessments(
          drafts[activeTab],
          detail.assessments as any,
          activeTab === 'quizzes' ? 'quiz' : 'test'
        )
        if (parsed.errors.length > 0) throw new Error(parsed.errors.join('\n'))
        const response = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}/assessments/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assessments: parsed.assessments }),
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
      }

      await loadBlueprints(selectedBlueprintId)
      await loadDetail(selectedBlueprintId)
    } catch (err: any) {
      setError(err.message || 'Failed to save current tab')
    } finally {
      setSaving(false)
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
      await loadBlueprints(data.blueprint.id)
    } catch (err: any) {
      setError(err.message || 'Failed to import course package')
    } finally {
      if (event.target) event.target.value = ''
    }
  }

  async function runCopilot(target: EditorTab | 'analyze') {
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
      setActiveTab(aiPreview.target === 'lesson-plans' ? 'lesson-plans' : aiPreview.target)
      setAiPreview(null)
      await loadDetail(selectedBlueprintId)
    } catch (err: any) {
      setError(err.message || 'Failed to apply copilot preview')
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <PageLayout className="mx-auto max-w-7xl">
      <PageActionBar
        primary={
          <div>
            <div className="text-sm font-medium text-text-default">Course Blueprints</div>
            <div className="text-xs text-text-muted">Reusable course packages for new classrooms</div>
          </div>
        }
        actions={[
          { id: 'back-classrooms', label: 'Classrooms', onSelect: () => router.push('/classrooms') },
          { id: 'new-blueprint', label: 'New blueprint', onSelect: () => setShowCreate(true) },
          { id: 'import-package', label: 'Import package', onSelect: () => importInputRef.current?.click() },
          ...(selectedBlueprintId
            ? [
                { id: 'create-classroom', label: 'Create classroom', onSelect: () => setShowCreateClassroom(true) },
                { id: 'export-package', label: 'Export package', onSelect: handleExport },
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

        <div className="grid gap-6 lg:grid-cols-[320px,minmax(0,1fr)]">
          <aside className="rounded-card border border-border bg-surface p-4">
            {loadingList ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : blueprints.length === 0 ? (
              <div className="space-y-3 text-center">
                <p className="text-sm text-text-muted">No course blueprints yet.</p>
                <Button type="button" onClick={() => setShowCreate(true)}>
                  Create Blueprint
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
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <FormField label="Title">
                    <Input value={meta.title} onChange={(e) => setMeta((current) => ({ ...current, title: e.target.value }))} />
                  </FormField>
                  <FormField label="Subject">
                    <Input value={meta.subject} onChange={(e) => setMeta((current) => ({ ...current, subject: e.target.value }))} />
                  </FormField>
                  <FormField label="Grade Level">
                    <Input value={meta.grade_level} onChange={(e) => setMeta((current) => ({ ...current, grade_level: e.target.value }))} />
                  </FormField>
                  <FormField label="Course Code">
                    <Input value={meta.course_code} onChange={(e) => setMeta((current) => ({ ...current, course_code: e.target.value }))} />
                  </FormField>
                  <FormField label="Term Template">
                    <Input value={meta.term_template} onChange={(e) => setMeta((current) => ({ ...current, term_template: e.target.value }))} />
                  </FormField>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="secondary" onClick={saveMetadata} disabled={saving}>
                    Save Metadata
                  </Button>
                  {counts ? (
                    <div className="text-xs text-text-muted">
                      {counts.assignments} assignments • {counts.quizzes} quizzes • {counts.tests} tests • {counts.lesson_templates} lesson templates
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {(Object.keys(TAB_LABELS) as EditorTab[]).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                        activeTab === tab
                          ? 'bg-primary text-text-inverse'
                          : 'bg-surface-2 text-text-default hover:bg-surface-hover'
                      }`}
                    >
                      {TAB_LABELS[tab]}
                    </button>
                  ))}
                </div>

                {activeTab === 'copilot' ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-[220px,minmax(0,1fr)]">
                      <FormField label="Copilot Target">
                        <select
                          value={aiTarget}
                          onChange={(e) => setAiTarget(e.target.value as EditorTab)}
                          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="overview">Overview</option>
                          <option value="outline">Outline</option>
                          <option value="resources">Resources</option>
                          <option value="assignments">Assignments</option>
                          <option value="quizzes">Quizzes</option>
                          <option value="tests">Tests</option>
                          <option value="lesson-plans">Lesson Plans</option>
                        </select>
                      </FormField>
                      <FormField label="Teacher Prompt">
                        <Input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="Focus on a coding-heavy semester with weekly checkpoints." />
                      </FormField>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button type="button" onClick={() => runCopilot('analyze')} disabled={aiBusy}>
                        {aiBusy ? 'Working...' : 'Analyze Blueprint'}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => runCopilot(aiTarget)} disabled={aiBusy}>
                        Generate Preview
                      </Button>
                      {aiPreview ? (
                        <Button type="button" variant="secondary" onClick={applyCopilotPreview} disabled={aiBusy}>
                          Apply Preview
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

                    {aiPreview ? (
                      <div className="space-y-2">
                        <div className="text-sm font-semibold text-text-default">Preview: {TAB_LABELS[aiPreview.target]}</div>
                        <textarea
                          value={aiPreview.content}
                          onChange={(e) => setAiPreview((current) => (current ? { ...current, content: e.target.value } : current))}
                          className="min-h-[420px] w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <textarea
                      value={drafts[activeTab]}
                      onChange={(e) => setDrafts((current) => ({ ...current, [activeTab]: e.target.value }))}
                      className="min-h-[520px] w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <div className="flex justify-end">
                      <Button type="button" onClick={saveCurrentTab} disabled={saving}>
                        {saving ? 'Saving...' : `Save ${TAB_LABELS[activeTab]}`}
                      </Button>
                    </div>
                  </div>
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
