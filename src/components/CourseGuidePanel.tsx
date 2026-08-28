'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ExternalLink, Pencil, SlidersHorizontal } from 'lucide-react'
import { CourseGuideOptionsDialog } from '@/components/CourseGuideOptionsDialog'
import {
  CourseGuideView,
  type CourseGuideEditableSection,
} from '@/components/CourseGuideView'
import { MarkdownContentEditor } from '@/components/editor'
import { FloatingActionCluster } from '@/components/FloatingActionCluster'
import type { CourseGuideData } from '@/lib/course-guide'
import {
  normalizeActualCourseSiteConfig,
  slugifyCourseSiteValue,
} from '@/lib/course-site-publishing'
import { fetchCachedJSON, invalidateCachedJSON } from '@/lib/request-cache'
import {
  ACTIONBAR_BUTTON_SECONDARY_CLASSNAME,
  Button,
  ConfirmDialog,
  PageActionBar,
  PageContent,
  PageLayout,
  PageState,
  cn,
  useAppMessage,
} from '@/ui'
import type { ActualCourseSiteConfig, Classroom, TiptapContent } from '@/types'

type CourseGuidePanelProps = {
  classroom: Classroom
  role: 'teacher' | 'student'
  onClassroomUpdated?: (classroom: Classroom) => void
  renderResourcesEditor?: (onSaved: (content: TiptapContent) => void) => ReactNode
}

type CourseGuideResponse = {
  guide: CourseGuideData
}

type SavedGuideOptions = {
  published: boolean
  slug: string
  config: ActualCourseSiteConfig
}

type DiscardTarget = CourseGuideEditableSection | 'exit' | null

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
  renderResourcesEditor,
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
  const [editMode, setEditMode] = useState(false)
  const [activeEditor, setActiveEditor] = useState<CourseGuideEditableSection | null>(null)
  const [overviewDraft, setOverviewDraft] = useState(classroom.course_overview_markdown || '')
  const [overviewSaving, setOverviewSaving] = useState(false)
  const [overviewError, setOverviewError] = useState('')
  const [discardTarget, setDiscardTarget] = useState<DiscardTarget>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [savedOptions, setSavedOptions] = useState<SavedGuideOptions>(() => optionsFromClassroom(classroom))
  const [draftOptions, setDraftOptions] = useState<SavedGuideOptions>(() => optionsFromClassroom(classroom))
  const [optionsSaving, setOptionsSaving] = useState(false)
  const [optionsError, setOptionsError] = useState('')

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
    setEditMode(false)
    setActiveEditor(null)
    setOverviewDraft(classroom.course_overview_markdown || '')
    setOverviewSaving(false)
    setOverviewError('')
    setDiscardTarget(null)
    setOptionsOpen(false)
    setSavedOptions(nextOptions)
    setDraftOptions(nextOptions)
    setOptionsSaving(false)
    setOptionsError('')
  }, [classroom])

  useEffect(() => {
    if (activeEditor !== 'overview') {
      setOverviewDraft(classroom.course_overview_markdown || '')
    }
  }, [activeEditor, classroom.course_overview_markdown])

  const publicGuideAvailable = savedOptions.published && !!savedOptions.slug
  const siteHref = publicGuideAvailable ? `/actual/${savedOptions.slug}` : ''
  const isArchived = !!classroom.archived_at
  const overviewSavedValue = state.status === 'ready'
    ? state.guide.overviewMarkdown
    : classroom.course_overview_markdown || ''
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

  function requestSection(section: CourseGuideEditableSection) {
    if (activeEditor === section) return
    if (activeEditor === 'overview' && overviewDirty) {
      setDiscardTarget(section)
      return
    }
    setOverviewError('')
    setActiveEditor(section)
  }

  function requestExitEditMode() {
    if (activeEditor === 'overview' && overviewDirty) {
      setDiscardTarget('exit')
      return
    }
    setActiveEditor(null)
    setEditMode(false)
  }

  function discardOverviewChanges() {
    const target = discardTarget
    setOverviewDraft(overviewSavedValue)
    setOverviewError('')
    setDiscardTarget(null)
    if (target === 'exit') {
      setActiveEditor(null)
      setEditMode(false)
      return
    }
    setActiveEditor(target)
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
      if (!response.ok) throw new Error(data.error || 'Failed to save the curriculum overview')
      if (currentClassroomIdRef.current !== classroomId) return

      invalidateCachedJSON(getCacheKey(classroomId))
      if (savedOptions.slug) invalidateCachedJSON(`public-course-guide:${savedOptions.slug}`)
      updateReadyGuide((guide) => ({ ...guide, overviewMarkdown: nextOverview }))
      if (data.classroom) onClassroomUpdated?.(data.classroom)
      setActiveEditor(null)
      showMessage({ text: 'Curriculum overview saved', tone: 'success' })
    } catch (error) {
      if (currentClassroomIdRef.current !== classroomId) return
      setOverviewError(error instanceof Error ? error.message : 'Failed to save the curriculum overview')
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
      updateReadyGuide((guide) => ({ ...guide, visibility: persisted.config }))
      if (!persisted.config.overview && activeEditor === 'overview') setActiveEditor(null)
      if (!persisted.config.resources && activeEditor === 'resources') setActiveEditor(null)
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

  const overviewEditor = (
    <div className="space-y-3">
      <MarkdownContentEditor
        markdown={overviewDraft}
        onMarkdownChange={setOverviewDraft}
        placeholder="Add curriculum context, course purpose, expectations, and rules..."
        editable={!overviewSaving && !isArchived}
        toolbarPreset="document"
        aria-label="Curriculum overview and expectations"
        className="min-h-28 sm:min-h-32"
      />
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
            setActiveEditor(null)
          }}
        >
          Cancel
        </Button>
        <Button type="button" disabled={overviewSaving || !overviewDirty} onClick={saveOverview}>
          {overviewSaving ? 'Saving...' : 'Save overview'}
        </Button>
      </div>
    </div>
  )

  const resourcesEditor = renderResourcesEditor?.((content) => {
    updateReadyGuide((guide) => ({ ...guide, resourcesContent: content }))
  })

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
            editMode={role === 'teacher' && editMode && !isArchived}
            activeEditor={activeEditor}
            onEditSection={role === 'teacher' && editMode && !isArchived ? requestSection : undefined}
            overviewEditor={overviewEditor}
            resourcesEditor={resourcesEditor}
          />
        </div>
      ) : null}

      {state.status === 'ready' && role === 'teacher' && !isArchived ? (
        <FloatingActionCluster
          placement="top"
          role="group"
          aria-label="Course Guide actions"
          className="top-24 p-0 sm:top-14"
        >
          <div className="flex items-center justify-center gap-1">
            {editMode ? (
              <>
                <Button type="button" size="sm" variant="secondary" onClick={openOptions}>
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                  Guide options
                </Button>
                <Button type="button" size="sm" onClick={requestExitEditMode} disabled={overviewSaving}>
                  Done
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setOverviewDraft(overviewSavedValue)
                  setEditMode(true)
                }}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Edit guide
              </Button>
            )}
          </div>
        </FloatingActionCluster>
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
        onSave={saveOptions}
        onClose={() => {
          setDraftOptions(savedOptions)
          setOptionsError('')
          setOptionsOpen(false)
        }}
      />

      <ConfirmDialog
        isOpen={discardTarget !== null}
        title="Discard overview changes?"
        description="Your unsaved curriculum overview changes will be lost."
        confirmLabel="Discard"
        confirmVariant="danger"
        onCancel={() => setDiscardTarget(null)}
        onConfirm={discardOverviewChanges}
      />
    </PageLayout>
  )
}
