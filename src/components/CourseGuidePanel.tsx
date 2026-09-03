'use client'

import { useEffect, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { CourseGuideOptionsDialog } from '@/components/CourseGuideOptionsDialog'
import { CourseGuideImportDialog } from '@/components/CourseGuideImportDialog'
import { CourseGuideView } from '@/components/CourseGuideView'
import { MarkdownContentEditor } from '@/components/editor'
import { toCourseGuideVisibility, type CourseGuideData } from '@/lib/course-guide'
import {
  normalizeActualCourseSiteConfig,
  slugifyCourseSiteValue,
} from '@/lib/course-site-publishing'
import { fetchCachedJSON, invalidateCachedJSON } from '@/lib/request-cache'
import {
  ACTIONBAR_BUTTON_SECONDARY_CLASSNAME,
  Button,
  FormField,
  PageActionBar,
  PageContent,
  PageLayout,
  PageState,
  type ActionBarItem,
  cn,
  useAppMessage,
} from '@/ui'
import type { ActualCourseSiteConfig, Classroom } from '@/types'

type CourseGuidePanelProps = {
  classroom: Classroom
  role: 'teacher' | 'student'
  onClassroomUpdated?: (classroom: Classroom) => void
}

type CourseGuideResponse = {
  guide: CourseGuideData
}

type SavedGuideOptions = {
  published: boolean
  slug: string
  config: ActualCourseSiteConfig
}

type EditorMode = 'visual' | 'markdown'

function getCacheKey(classroomId: string) {
  return `classroom-course-guide:${classroomId}`
}

function optionsFromClassroom(classroom: Classroom): SavedGuideOptions {
  return {
    published: !!classroom.actual_site_published,
    slug: classroom.actual_site_slug || '',
    config: normalizeActualCourseSiteConfig(classroom.actual_site_config),
  }
}

export function CourseGuidePanel({
  classroom,
  role,
  onClassroomUpdated,
}: CourseGuidePanelProps) {
  const { showMessage } = useAppMessage()
  const currentClassroomIdRef = useRef(classroom.id)
  const resetClassroomIdRef = useRef(classroom.id)
  currentClassroomIdRef.current = classroom.id
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; guide: CourseGuideData }
    | { status: 'error' }
  >({ status: 'loading' })
  const [editorMode, setEditorMode] = useState<EditorMode | null>(null)
  const editorModeRef = useRef<EditorMode | null>(null)
  editorModeRef.current = editorMode
  const [overviewDraft, setOverviewDraft] = useState(classroom.course_overview_markdown || '')
  const [overviewSavedValue, setOverviewSavedValue] = useState(classroom.course_overview_markdown || '')
  const [overviewSaving, setOverviewSaving] = useState(false)
  const [overviewError, setOverviewError] = useState('')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [savedOptions, setSavedOptions] = useState<SavedGuideOptions>(() => optionsFromClassroom(classroom))
  const [draftOptions, setDraftOptions] = useState<SavedGuideOptions>(() => optionsFromClassroom(classroom))
  const [optionsSaving, setOptionsSaving] = useState(false)
  const [optionsError, setOptionsError] = useState('')
  const [importOpen, setImportOpen] = useState(false)

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })

    void fetchCachedJSON<CourseGuideResponse>(
      getCacheKey(classroom.id),
      `/api/classrooms/${encodeURIComponent(classroom.id)}/course-guide`,
      {
        errorMessage: 'The course guide could not be loaded.',
        ttlMs: 0,
      },
    ).then((response) => {
      if (current) setState({ status: 'ready', guide: response.guide })
    }).catch(() => {
      if (current) setState({ status: 'error' })
    })

    return () => {
      current = false
    }
  }, [attempt, classroom.id, classroom.updated_at])

  useEffect(() => {
    if (resetClassroomIdRef.current === classroom.id) return
    resetClassroomIdRef.current = classroom.id
    const nextOptions = optionsFromClassroom(classroom)
    setEditorMode(null)
    setOverviewDraft(classroom.course_overview_markdown || '')
    setOverviewSavedValue(classroom.course_overview_markdown || '')
    setOverviewSaving(false)
    setOverviewError('')
    setOptionsOpen(false)
    setSavedOptions(nextOptions)
    setDraftOptions(nextOptions)
    setOptionsSaving(false)
    setOptionsError('')
    setImportOpen(false)
  }, [classroom])

  useEffect(() => {
    const nextOverview = classroom.course_overview_markdown || ''
    setOverviewSavedValue(nextOverview)
    if (editorModeRef.current === null) {
      setOverviewDraft(nextOverview)
    }
  }, [classroom.course_overview_markdown])

  const publicGuideAvailable = savedOptions.published && !!savedOptions.slug
  const siteHref = publicGuideAvailable ? `/actual/${savedOptions.slug}` : ''
  const isArchived = !!classroom.archived_at
  const overviewDirty = overviewDraft !== overviewSavedValue

  function updateReadyGuide(update: (guide: CourseGuideData) => CourseGuideData) {
    setState((current) => (
      current.status === 'ready'
        ? { status: 'ready', guide: update(current.guide) }
        : current
    ))
  }

  function openPublicGuide() {
    if (!siteHref) return
    window.open(siteHref, '_blank', 'noopener,noreferrer')
  }

  function openOptions() {
    setDraftOptions(savedOptions)
    setOptionsError('')
    setOptionsOpen(true)
  }

  function openEditor(mode: EditorMode) {
    if (editorMode === null) setOverviewDraft(overviewSavedValue)
    setOverviewError('')
    setEditorMode(mode)
  }

  async function saveOverview() {
    if (isArchived || overviewSaving) return
    const classroomId = classroom.id
    const nextOverview = overviewDraft
    setOverviewSaving(true)
    setOverviewError('')
    try {
      const response = await fetch(`/api/teacher/classrooms/${classroomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseOverviewMarkdown: nextOverview }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to save the course guide')
      if (currentClassroomIdRef.current !== classroomId) return

      invalidateCachedJSON(getCacheKey(classroomId))
      if (savedOptions.slug) invalidateCachedJSON(`public-course-guide:${savedOptions.slug}`)
      updateReadyGuide((guide) => ({ ...guide, overviewMarkdown: nextOverview }))
      setOverviewSavedValue(nextOverview)
      if (data.classroom) onClassroomUpdated?.(data.classroom)
      setEditorMode(null)
      showMessage({ text: 'Course guide saved', tone: 'success' })
    } catch (error) {
      if (currentClassroomIdRef.current !== classroomId) return
      setOverviewError(error instanceof Error ? error.message : 'Failed to save the course guide')
    } finally {
      if (currentClassroomIdRef.current === classroomId) setOverviewSaving(false)
    }
  }

  async function saveOptions() {
    if (isArchived || optionsSaving) return
    const classroomId = classroom.id
    const nextOptions = {
      ...draftOptions,
      slug: slugifyCourseSiteValue(draftOptions.slug),
    }
    setDraftOptions(nextOptions)
    setOptionsSaving(true)
    setOptionsError('')
    try {
      const response = await fetch(`/api/teacher/classrooms/${classroomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualSiteSlug: nextOptions.slug || null,
          actualSitePublished: nextOptions.published,
          actualSiteConfig: nextOptions.config,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to save guide options')
      if (currentClassroomIdRef.current !== classroomId) return

      invalidateCachedJSON(getCacheKey(classroomId))
      if (savedOptions.slug) invalidateCachedJSON(`public-course-guide:${savedOptions.slug}`)
      if (nextOptions.slug) invalidateCachedJSON(`public-course-guide:${nextOptions.slug}`)
      const persisted = data.classroom ? optionsFromClassroom(data.classroom) : nextOptions
      setSavedOptions(persisted)
      setDraftOptions(persisted)
      updateReadyGuide((guide) => ({
        ...guide,
        visibility: toCourseGuideVisibility(persisted.config),
      }))
      if (data.classroom) onClassroomUpdated?.(data.classroom)
      setOptionsOpen(false)
      showMessage({ text: 'Guide options saved', tone: 'success' })
    } catch (error) {
      if (currentClassroomIdRef.current !== classroomId) return
      setOptionsError(error instanceof Error ? error.message : 'Failed to save guide options')
    } finally {
      if (currentClassroomIdRef.current === classroomId) setOptionsSaving(false)
    }
  }

  const guideEditor = (
    <div className="space-y-3">
      {editorMode === 'markdown' ? (
        <FormField label="Course guide Markdown">
          <textarea
            value={overviewDraft}
            onChange={(event) => setOverviewDraft(event.target.value)}
            disabled={overviewSaving || isArchived}
            spellCheck={false}
            rows={18}
            className="min-h-80 w-full resize-y rounded-control border border-border bg-surface px-3 py-3 font-mono text-sm text-text-default focus-visible:outline-none focus-visible:ring-foundation focus-visible:ring-focus disabled:cursor-not-allowed disabled:bg-surface-2"
          />
        </FormField>
      ) : (
        <MarkdownContentEditor
          markdown={overviewDraft}
          onMarkdownChange={setOverviewDraft}
          placeholder="Paste or write your course guide..."
          editable={!overviewSaving && !isArchived}
          toolbarPreset="document"
          aria-label="Course guide"
          className="min-h-80"
        />
      )}
      {overviewError ? (
        <div role="alert" className="rounded-control border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
          {overviewError}
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={overviewSaving}
          onClick={() => {
            setOverviewDraft(overviewSavedValue)
            setOverviewError('')
            setEditorMode(null)
          }}
        >
          Cancel
        </Button>
        <Button type="button" disabled={overviewSaving || !overviewDirty} onClick={saveOverview}>
          {overviewSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )

  const teacherActions: ActionBarItem[] = [
    {
      id: 'edit-course-guide',
      label: 'Edit',
      disabled: state.status !== 'ready' || overviewSaving || editorMode === 'visual',
      onSelect: () => openEditor('visual'),
    },
    {
      id: 'edit-course-guide-markdown',
      label: 'Edit with Markdown',
      disabled: state.status !== 'ready' || overviewSaving || editorMode === 'markdown',
      onSelect: () => openEditor('markdown'),
    },
    {
      id: 'course-guide-options',
      label: 'Guide options',
      disabled: optionsSaving || overviewSaving,
      onSelect: openOptions,
    },
  ]

  return (
    <PageLayout
      width="full"
      density={role === 'teacher' ? 'teacher' : 'student'}
      bleedX={false}
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
    >
      {role === 'student' && publicGuideAvailable ? (
        <PageActionBar
          primary={null}
          trailing={(
            <a
              href={siteHref}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(ACTIONBAR_BUTTON_SECONDARY_CLASSNAME, 'shrink-0')}
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Open public guide
            </a>
          )}
        />
      ) : null}

      {role === 'teacher' && !isArchived ? (
        <PageActionBar primary={null} actions={teacherActions} />
      ) : null}

      {role === 'teacher' && isArchived ? (
        <PageActionBar
          primary={<p className="py-2 text-sm text-text-muted">Archived classroom · Course Guide is read-only.</p>}
          trailing={publicGuideAvailable ? (
            <Button type="button" variant="secondary" size="sm" onClick={openPublicGuide}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Open public guide
            </Button>
          ) : undefined}
        />
      ) : null}

      {state.status === 'loading' ? (
        <PageContent>
          <PageState kind="loading" title="Loading course guide" />
        </PageContent>
      ) : null}

      {state.status === 'error' ? (
        <PageContent>
          <PageState
            kind="error"
            title="Course guide unavailable"
            description="The course guide could not be loaded."
            action={(
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  invalidateCachedJSON(getCacheKey(classroom.id))
                  setAttempt((value) => value + 1)
                }}
              >
                Retry
              </Button>
            )}
          />
        </PageContent>
      ) : null}

      {state.status === 'ready' ? (
        <div>
          <CourseGuideView
            guide={state.guide}
            embedded
            editMode={role === 'teacher' && editorMode !== null && !isArchived}
            overviewEditor={guideEditor}
          />
        </div>
      ) : null}

      <CourseGuideOptionsDialog
        isOpen={optionsOpen}
        saving={optionsSaving}
        error={optionsError}
        published={draftOptions.published}
        slug={draftOptions.slug}
        config={draftOptions.config}
        onPublishedChange={(published) => setDraftOptions((current) => ({
          ...current,
          published,
          slug: published && !current.slug ? slugifyCourseSiteValue(classroom.title) : current.slug,
        }))}
        onSlugChange={(slug) => setDraftOptions((current) => ({
          ...current,
          slug: slugifyCourseSiteValue(slug),
        }))}
        onConfigChange={(config) => setDraftOptions((current) => ({ ...current, config }))}
        onGenerateSlug={() => setDraftOptions((current) => ({
          ...current,
          slug: slugifyCourseSiteValue(classroom.title),
        }))}
        onOpenPublicGuide={() => {
          const draftHref = draftOptions.slug ? `/actual/${draftOptions.slug}` : ''
          if (draftHref) window.open(draftHref, '_blank', 'noopener,noreferrer')
        }}
        onImportCurriculum={() => {
          if (editorMode !== null && overviewDirty) {
            setOptionsError('Save or cancel your course guide edits before importing curriculum.')
            return
          }
          setDraftOptions(savedOptions)
          setOptionsError('')
          setOptionsOpen(false)
          setImportOpen(true)
        }}
        onSave={saveOptions}
        onClose={() => {
          setDraftOptions(savedOptions)
          setOptionsError('')
          setOptionsOpen(false)
        }}
      />

      <CourseGuideImportDialog
        isOpen={importOpen}
        classroom={{ ...classroom, course_overview_markdown: overviewSavedValue }}
        onApplied={(updatedClassroom) => {
          invalidateCachedJSON(getCacheKey(classroom.id))
          if (savedOptions.slug) invalidateCachedJSON(`public-course-guide:${savedOptions.slug}`)
          updateReadyGuide((guide) => ({
            ...guide,
            overviewMarkdown: updatedClassroom.course_overview_markdown || '',
          }))
          setOverviewSavedValue(updatedClassroom.course_overview_markdown || '')
          setOverviewDraft(updatedClassroom.course_overview_markdown || '')
          onClassroomUpdated?.(updatedClassroom)
          showMessage({ text: 'Reviewed curriculum draft added', tone: 'success' })
        }}
        onClose={() => setImportOpen(false)}
      />
    </PageLayout>
  )
}
