'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'
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
import type { MouseEvent } from 'react'

type CourseGuidePanelProps = {
  classroom: Classroom
  role: 'teacher' | 'student'
  onClassroomUpdated?: (classroom: Classroom) => void
}

type CourseGuideResponse = {
  guide: CourseGuideData
}

class CourseGuideReadError extends Error {
  constructor(readonly status: number) {
    super('The course guide could not be loaded.')
  }
}

type GuideReadState = { owner: string } & (
  | { status: 'loading'; denied?: boolean }
  | { status: 'ready'; guide: CourseGuideData; refreshing: boolean; refreshError: boolean }
  | { status: 'error'; denied: boolean }
)

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
  const owner = `${role}:${classroom.id}`
  const committedOwnerRef = useRef({ key: owner })
  const committedClassroomRef = useRef(classroom)
  const currentClassroomIdRef = useRef(classroom.id)
  const readRequestRef = useRef(0)
  const readPendingRef = useRef(false)
  const guideRegionRef = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [readState, setState] = useState<GuideReadState>({ owner, status: 'loading' })
  // A changed owner cannot render the previous owner's snapshot before effects run.
  const state: GuideReadState = readState.owner === owner
    ? readState
    : { owner, status: 'loading' }
  const [editorMode, setEditorMode] = useState<EditorMode | null>(null)
  const editorModeRef = useRef<EditorMode | null>(null)
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

  const resetOwnerWork = useCallback(() => {
    const committedClassroom = committedClassroomRef.current
    const nextOptions = optionsFromClassroom(committedClassroom)
    setEditorMode(null)
    setOverviewDraft(committedClassroom.course_overview_markdown || '')
    setOverviewSavedValue(committedClassroom.course_overview_markdown || '')
    setOverviewSaving(false)
    setOverviewError('')
    setOptionsOpen(false)
    setSavedOptions(nextOptions)
    setDraftOptions(nextOptions)
    setOptionsSaving(false)
    setOptionsError('')
    setImportOpen(false)
  }, [])

  useLayoutEffect(() => {
    committedClassroomRef.current = classroom
  }, [classroom])

  useLayoutEffect(() => {
    // Only committed renders may retire live read/write authority. A suspended
    // render for another owner must not invalidate the still-visible owner.
    if (committedOwnerRef.current.key !== owner) {
      committedOwnerRef.current = { key: owner }
      currentClassroomIdRef.current = classroom.id
      setState({ owner, status: 'loading' })
      resetOwnerWork()
    }
    readRequestRef.current += 1
    readPendingRef.current = true
  }, [owner, classroom.id, classroom.updated_at, attempt, resetOwnerWork])

  useLayoutEffect(() => {
    editorModeRef.current = editorMode
  }, [editorMode])

  useLayoutEffect(() => () => {
    readRequestRef.current += 1
    committedOwnerRef.current = { key: committedOwnerRef.current.key }
  }, [])

  useEffect(() => {
    let current = true
    const committedOwner = committedOwnerRef.current
    const requestId = readRequestRef.current
    const cacheKey = getCacheKey(classroom.id)
    const isCurrent = () => current && committedOwnerRef.current === committedOwner &&
      readRequestRef.current === requestId

    setState((previous) => previous.owner === owner && previous.status === 'ready'
      ? { ...previous, refreshing: true, refreshError: false }
      : { owner, status: 'loading', denied: previous.owner === owner && previous.status !== 'ready' && previous.denied })

    // A newer logical read must not attach to an obsolete classroom-key pending
    // request. Keep governed caching without changing the shared cache helper.
    invalidateCachedJSON(cacheKey)
    void fetchJSONWithCache<CourseGuideResponse>(cacheKey, async () => {
      const response = await fetch(`/api/classrooms/${encodeURIComponent(classroom.id)}/course-guide`, undefined)
      if (!response.ok) throw new CourseGuideReadError(response.status)
      return await response.json() as CourseGuideResponse
    }, 0).then((response) => {
      if (!isCurrent()) return
      readPendingRef.current = false
      setState({ owner, status: 'ready', guide: response.guide, refreshing: false, refreshError: false })
    }).catch((error: unknown) => {
      if (!isCurrent()) return
      readPendingRef.current = false
      const denied = error instanceof CourseGuideReadError && [401, 403, 404].includes(error.status)
      if (denied) {
        invalidateCachedJSON(cacheKey)
        // Retire writes too: a late response cannot revive denied editor data.
        committedOwnerRef.current = { key: owner }
        resetOwnerWork()
      }
      setState((previous) => !denied && previous.owner === owner && previous.status === 'ready'
        ? { ...previous, refreshing: false, refreshError: true }
        : { owner, status: 'error', denied: denied || (previous.owner === owner && previous.status !== 'ready' && !!previous.denied) })
    })

    return () => {
      current = false
    }
  }, [attempt, owner, classroom.id, classroom.updated_at, resetOwnerWork])

  useEffect(() => {
    const nextOverview = classroom.course_overview_markdown || ''
    setOverviewSavedValue(nextOverview)
    if (editorModeRef.current === null) {
      setOverviewDraft(nextOverview)
    }
  }, [classroom.course_overview_markdown])

  const currentOwnerWork = readState.owner === owner && !(state.status !== 'ready' && state.denied)
  const renderedOwner = committedOwnerRef.current
  const publicGuideAvailable = currentOwnerWork && savedOptions.published && !!savedOptions.slug
  const siteHref = publicGuideAvailable ? `/actual/${savedOptions.slug}` : ''
  const isArchived = !!classroom.archived_at
  const overviewDirty = overviewDraft !== overviewSavedValue

  function updateReadyGuide(update: (guide: CourseGuideData) => CourseGuideData) {
    setState((current) => (
      current.owner === owner && current.status === 'ready'
        ? { ...current, guide: update(current.guide) }
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
    const committedOwner = committedOwnerRef.current
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
      if (currentClassroomIdRef.current !== classroomId || committedOwnerRef.current !== committedOwner) return

      invalidateCachedJSON(getCacheKey(classroomId))
      if (savedOptions.slug) invalidateCachedJSON(`public-course-guide:${savedOptions.slug}`)
      updateReadyGuide((guide) => ({ ...guide, overviewMarkdown: nextOverview }))
      setOverviewSavedValue(nextOverview)
      if (data.classroom) onClassroomUpdated?.(data.classroom)
      setEditorMode(null)
      showMessage({ text: 'Course guide saved', tone: 'success' })
    } catch (error) {
      if (currentClassroomIdRef.current !== classroomId || committedOwnerRef.current !== committedOwner) return
      setOverviewError(error instanceof Error ? error.message : 'Failed to save the course guide')
    } finally {
      if (currentClassroomIdRef.current === classroomId && committedOwnerRef.current === committedOwner) setOverviewSaving(false)
    }
  }

  async function saveOptions() {
    if (isArchived || optionsSaving) return
    const classroomId = classroom.id
    const committedOwner = committedOwnerRef.current
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
      if (currentClassroomIdRef.current !== classroomId || committedOwnerRef.current !== committedOwner) return

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
      if (currentClassroomIdRef.current !== classroomId || committedOwnerRef.current !== committedOwner) return
      setOptionsError(error instanceof Error ? error.message : 'Failed to save guide options')
    } finally {
      if (currentClassroomIdRef.current === classroomId && committedOwnerRef.current === committedOwner) setOptionsSaving(false)
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

  function retryRead(event: MouseEvent<HTMLButtonElement>) {
    if (readPendingRef.current) return
    if (document.activeElement === event.currentTarget) {
      guideRegionRef.current?.focus({ preventScroll: true })
    }
    readPendingRef.current = true
    readRequestRef.current += 1
    invalidateCachedJSON(getCacheKey(classroom.id))
    setAttempt((value) => value + 1)
  }

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

      {role === 'teacher' && !isArchived && currentOwnerWork ? (
        <PageActionBar primary={null} actions={teacherActions} />
      ) : null}

      {role === 'teacher' && isArchived && currentOwnerWork ? (
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

      <div
        ref={guideRegionRef}
        role="region"
        aria-label="Course guide workspace"
        tabIndex={-1}
        className="min-w-0 outline-none focus-visible:ring-foundation focus-visible:ring-focus"
      >
        {state.status === 'loading' ? (
          <PageContent>
            <PageState kind="loading" title="Loading course guide" />
          </PageContent>
        ) : null}

        {state.status === 'error' ? (
          <PageContent>
            <PageState
              kind={state.denied ? 'forbidden' : 'error'}
              title="Course guide unavailable"
              description="The course guide could not be loaded."
              action={(
                <Button
                  type="button"
                  variant="secondary"
                  onClick={retryRead}
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

        {state.status === 'ready' && state.refreshing ? (
          <span role="status" className="sr-only">Refreshing course guide</span>
        ) : null}

        {state.status === 'ready' && state.refreshError ? (
          <PageContent>
            <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
              <span>Course guide could not be refreshed. Showing the last loaded course guide.</span>
              <Button type="button" variant="secondary" size="sm" onClick={retryRead}>Retry</Button>
            </div>
          </PageContent>
        ) : null}
      </div>

      <CourseGuideOptionsDialog
        isOpen={optionsOpen && currentOwnerWork}
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
        key={owner}
        isOpen={importOpen && currentOwnerWork}
        classroom={{ ...classroom, course_overview_markdown: overviewSavedValue }}
        onApplied={(updatedClassroom) => {
          if (committedOwnerRef.current !== renderedOwner || currentClassroomIdRef.current !== classroom.id) return
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
