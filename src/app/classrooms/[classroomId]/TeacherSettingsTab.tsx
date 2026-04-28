'use client'

import { useMemo, useState, useId } from 'react'
import { useRouter } from 'next/navigation'
import { Info } from 'lucide-react'
import { Button, ConfirmDialog, DialogPanel, FormField, Input, Tooltip } from '@/ui'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { DEFAULT_ACTUAL_COURSE_SITE_CONFIG, slugifyCourseSiteValue } from '@/lib/course-site-publishing'
import { TeacherCalendarTab } from './TeacherCalendarTab'
import type { ActualCourseSiteConfig, Classroom, LessonPlanVisibility } from '@/types'

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function generateJoinCode() {
  return Array.from({ length: 6 })
    .map(() => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)])
    .join('')
}

type SettingsSection = 'general' | 'class-days'

interface Props {
  classroom: Classroom
  sectionParam?: string | null
  onSectionChange?: (section: SettingsSection) => void
}

export function TeacherSettingsTab({
  classroom,
  sectionParam,
  onSectionChange = () => {},
}: Props) {
  const router = useRouter()
  const section: SettingsSection = sectionParam === 'class-days' ? 'class-days' : 'general'
  const allowEnrollmentId = useId()
  const titleId = useId()
  const actualSiteSlugId = useId()
  const actualOverviewId = useId()
  const actualOutlineId = useId()
  const isReadOnly = !!classroom.archived_at
  const [title, setTitle] = useState(classroom.title)
  const [titleSaving, setTitleSaving] = useState(false)
  const [titleError, setTitleError] = useState<string>('')
  const [titleSuccess, setTitleSuccess] = useState<string>('')
  const [joinCode, setJoinCode] = useState(classroom.class_code)
  const [allowEnrollment, setAllowEnrollment] = useState<boolean>(classroom.allow_enrollment)
  const [saving, setSaving] = useState(false)
  const [enrollmentError, setEnrollmentError] = useState<string>('')
  const [enrollmentSuccess, setEnrollmentSuccess] = useState<string>('')
  const [joinCodeError, setJoinCodeError] = useState<string>('')
  const [joinCodeSuccess, setJoinCodeSuccess] = useState<string>('')
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [copyNotice, setCopyNotice] = useState<string>('')
  const [lessonPlanVisibility, setLessonPlanVisibility] = useState<LessonPlanVisibility>(
    classroom.lesson_plan_visibility || 'current_week'
  )
  const [visibilityError, setVisibilityError] = useState<string>('')
  const [visibilitySuccess, setVisibilitySuccess] = useState<string>('')
  const [visibilitySaving, setVisibilitySaving] = useState(false)
  const visibilityId = useId()
  const [actualSiteSlug, setActualSiteSlug] = useState(classroom.actual_site_slug || '')
  const [actualSitePublished, setActualSitePublished] = useState(!!classroom.actual_site_published)
  const [actualSiteConfig, setActualSiteConfig] = useState<ActualCourseSiteConfig>(
    classroom.actual_site_config || DEFAULT_ACTUAL_COURSE_SITE_CONFIG
  )
  const [courseOverviewMarkdown, setCourseOverviewMarkdown] = useState(classroom.course_overview_markdown || '')
  const [courseOutlineMarkdown, setCourseOutlineMarkdown] = useState(classroom.course_outline_markdown || '')
  const [siteSaving, setSiteSaving] = useState(false)
  const [siteError, setSiteError] = useState('')
  const [siteSuccess, setSiteSuccess] = useState('')
  const [showCreateBlueprintDialog, setShowCreateBlueprintDialog] = useState(false)
  const [blueprintTitle, setBlueprintTitle] = useState(classroom.title)
  const [blueprintBusy, setBlueprintBusy] = useState(false)
  const [blueprintError, setBlueprintError] = useState('')

  const origin = useMemo(() => {
    if (typeof window === 'undefined') return ''
    return window.location.origin
  }, [])
  const joinLink = `${origin}/join/${joinCode}`

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore clipboard failures
    }
  }

  async function copyWithNotice(label: string, text: string) {
    await copy(text)
    setCopyNotice(`${label} copied to clipboard.`)
    setTimeout(() => setCopyNotice(''), 2000)
  }

  async function saveTitle() {
    if (isReadOnly) return
    const trimmed = title.trim()
    if (!trimmed) {
      setTitleError('Course name cannot be empty')
      return
    }
    if (trimmed === classroom.title) {
      return
    }
    setTitleSaving(true)
    setTitleError('')
    setTitleSuccess('')
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update course name')
      }
      setTitle(data.classroom?.title || trimmed)
      setTitleSuccess('Course name updated.')
      setTimeout(() => setTitleSuccess(''), 2000)
    } catch (err: any) {
      setTitleError(err.message || 'Failed to update course name')
    } finally {
      setTitleSaving(false)
    }
  }

  async function saveAllowEnrollment(nextValue: boolean) {
    if (isReadOnly) return
    setSaving(true)
    setEnrollmentError('')
    setEnrollmentSuccess('')
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowEnrollment: nextValue }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update settings')
      }
      setAllowEnrollment(!!data.classroom?.allow_enrollment)
      setEnrollmentSuccess('Settings saved.')
      setTimeout(() => setEnrollmentSuccess(''), 2000)
    } catch (err: any) {
      setEnrollmentError(err.message || 'Failed to update settings')
    } finally {
      setSaving(false)
    }
  }

  async function regenerateJoinCode() {
    if (isReadOnly) return
    setIsRegenerating(true)
    setJoinCodeError('')
    setJoinCodeSuccess('')
    try {
      const newCode = generateJoinCode()
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classCode: newCode }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to regenerate join code')
      }
      setJoinCode(data.classroom?.class_code || newCode)
      setJoinCodeSuccess('Join code regenerated.')
    } catch (err: any) {
      setJoinCodeError(err.message || 'Failed to regenerate join code')
    } finally {
      setIsRegenerating(false)
      setShowRegenerateConfirm(false)
    }
  }

  async function saveLessonPlanVisibility(value: LessonPlanVisibility) {
    if (isReadOnly) return
    setVisibilitySaving(true)
    setVisibilityError('')
    setVisibilitySuccess('')
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonPlanVisibility: value }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update visibility setting')
      }
      setLessonPlanVisibility(data.classroom?.lesson_plan_visibility || value)
      setVisibilitySuccess('Calendar visibility updated.')
    } catch (err: any) {
      setVisibilityError(err.message || 'Failed to update visibility setting')
    } finally {
      setVisibilitySaving(false)
    }
  }

  async function saveActualSiteSettings() {
    if (isReadOnly) return
    setSiteSaving(true)
    setSiteError('')
    setSiteSuccess('')
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualSiteSlug: actualSiteSlug || null,
          actualSitePublished,
          actualSiteConfig,
          courseOverviewMarkdown,
          courseOutlineMarkdown,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save actual course site settings')
      }
      setActualSiteSlug(data.classroom?.actual_site_slug || '')
      setActualSitePublished(!!data.classroom?.actual_site_published)
      setActualSiteConfig(data.classroom?.actual_site_config || actualSiteConfig)
      setCourseOverviewMarkdown(data.classroom?.course_overview_markdown || courseOverviewMarkdown)
      setCourseOutlineMarkdown(data.classroom?.course_outline_markdown || courseOutlineMarkdown)
      setSiteSuccess('Actual course site settings saved.')
      setTimeout(() => setSiteSuccess(''), 2000)
    } catch (err: any) {
      setSiteError(err.message || 'Failed to save actual course site settings')
    } finally {
      setSiteSaving(false)
    }
  }

  function openCreateBlueprintDialog() {
    setBlueprintTitle(classroom.title)
    setBlueprintError('')
    setShowCreateBlueprintDialog(true)
  }

  function closeCreateBlueprintDialog() {
    if (blueprintBusy) return
    setBlueprintError('')
    setShowCreateBlueprintDialog(false)
  }

  async function createBlueprintFromClassroom() {
    if (isReadOnly) return
    setBlueprintBusy(true)
    setBlueprintError('')
    try {
      const response = await fetch(`/api/teacher/classrooms/${classroom.id}/blueprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: blueprintTitle.trim() || classroom.title }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create classroom blueprint')
      }
      router.push(data.redirect_url || `/teacher/blueprints?blueprint=${data.blueprint_id}&fromClassroom=${classroom.id}`)
    } catch (err: any) {
      setBlueprintError(err.message || 'Failed to create classroom blueprint')
    } finally {
      setBlueprintBusy(false)
    }
  }

  return (
    <PageLayout>
      {/* Sub-tab navigation */}
      <div className="mb-2 flex border-b border-border">
        <button
          type="button"
          onClick={() => onSectionChange('general')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            section === 'general'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted hover:text-text-default hover:border-border'
          }`}
        >
          General
        </button>
        <button
          type="button"
          onClick={() => onSectionChange('class-days')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            section === 'class-days'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted hover:text-text-default hover:border-border'
          }`}
        >
          Class Days
        </button>
      </div>

      {section === 'general' ? (
        <PageContent className="space-y-4 pt-0">
            <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <label htmlFor={titleId} className="text-sm font-semibold text-text-default">
                  Course Name
                </label>
                <Tooltip content="Name shown to students and in reports" side="right">
                  <span className="text-text-muted cursor-help">
                    <Info size={14} />
                  </span>
                </Tooltip>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-stretch gap-3">
                <input
                  id={titleId}
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      saveTitle()
                    }
                  }}
                  disabled={titleSaving || isReadOnly}
                  className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  placeholder="Enter course name"
                />
                {titleSaving && <span className="text-sm text-text-muted self-center">Saving...</span>}
              </div>
              {titleError && <div className="text-sm text-danger">{titleError}</div>}
              {titleSuccess && <div className="text-sm text-success">{titleSuccess}</div>}
            </div>

            <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-text-default">Join Code</div>
                <Tooltip content="Students must be on the roster to join" side="right">
                  <span className="text-text-muted cursor-help">
                    <Info size={14} />
                  </span>
                </Tooltip>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-stretch gap-3">
                <button
                  type="button"
                  className="w-full sm:w-auto rounded-md border border-border bg-surface-2 px-3 py-2 text-left font-mono text-base font-semibold text-text-default hover:bg-surface-hover"
                  onClick={() => copyWithNotice('Join code', joinCode)}
                  aria-label="Copy join code"
                >
                  {joinCode}
                </button>

                <Button
                  variant="secondary"
                  onClick={() => setShowRegenerateConfirm(true)}
                  disabled={isRegenerating || isReadOnly}
                  className="w-full sm:w-auto"
                >
                  {isRegenerating ? 'Generating…' : 'New code'}
                </Button>

                <button
                  type="button"
                  className="w-full flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-left font-mono text-xs text-text-default hover:bg-surface-hover truncate"
                  onClick={() => copyWithNotice('Join link', joinLink)}
                  aria-label="Copy join link"
                  title={joinLink}
                >
                  {joinLink}
                </button>
              </div>

              <div className="flex items-center gap-3 pt-2 border-t border-border">
                <input
                  id={allowEnrollmentId}
                  type="checkbox"
                  checked={allowEnrollment}
                  onChange={(e) => saveAllowEnrollment(e.target.checked)}
                  disabled={saving || isReadOnly}
                  className="h-4 w-4"
                />
                <label htmlFor={allowEnrollmentId} className="text-sm text-text-default">
                  Allow joining
                </label>
                {saving && <span className="text-sm text-text-muted">Saving...</span>}
              </div>

              {joinCodeError && <div className="text-sm text-danger">{joinCodeError}</div>}
              {joinCodeSuccess && <div className="text-sm text-success">{joinCodeSuccess}</div>}
              {enrollmentError && <div className="text-sm text-danger">{enrollmentError}</div>}
              {enrollmentSuccess && <div className="text-sm text-success">{enrollmentSuccess}</div>}
              {copyNotice && <div className="text-xs text-info">{copyNotice}</div>}
            </div>

            <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-text-default">Calendar Visibility</div>
                <Tooltip content="Control how far ahead students can see lesson plans" side="right">
                  <span className="text-text-muted cursor-help">
                    <Info size={14} />
                  </span>
                </Tooltip>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <label htmlFor={visibilityId} className="sr-only">
                  Calendar visibility
                </label>
                <select
                  id={visibilityId}
                  value={lessonPlanVisibility}
                  onChange={(e) => saveLessonPlanVisibility(e.target.value as LessonPlanVisibility)}
                  disabled={visibilitySaving || isReadOnly}
                  className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="current_week">Current week (and all previous)</option>
                  <option value="one_week_ahead">1 week ahead</option>
                  <option value="all">All (no restrictions)</option>
                </select>
                {visibilitySaving && <span className="text-sm text-text-muted">Saving...</span>}
              </div>

              {visibilityError && <div className="text-sm text-danger">{visibilityError}</div>}
              {visibilitySuccess && <div className="text-sm text-success">{visibilitySuccess}</div>}
            </div>

            <div className="bg-surface rounded-lg border border-border p-4 space-y-4">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-text-default">Actual Course Website</div>
                <Tooltip content="Publish a public-facing version of the current classroom state" side="right">
                  <span className="text-text-muted cursor-help">
                    <Info size={14} />
                  </span>
                </Tooltip>
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto]">
                <div>
                  <label htmlFor={actualSiteSlugId} className="mb-2 block text-sm text-text-muted">
                    Public slug
                  </label>
                  <Input
                    id={actualSiteSlugId}
                    value={actualSiteSlug}
                    onChange={(e) => setActualSiteSlug(slugifyCourseSiteValue(e.target.value))}
                    disabled={siteSaving || isReadOnly}
                    placeholder="career-studies-period-1"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={siteSaving || isReadOnly}
                    onClick={() => setActualSiteSlug(slugifyCourseSiteValue(title || classroom.title))}
                  >
                    Generate
                  </Button>
                </div>
              </div>

              <label className="flex items-center gap-3 text-sm text-text-default">
                <input
                  type="checkbox"
                  checked={actualSitePublished}
                  onChange={(e) => setActualSitePublished(e.target.checked)}
                  disabled={siteSaving || isReadOnly}
                  className="h-4 w-4"
                />
                Publish this classroom as the actual course website
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                {(
                  [
                    ['overview', 'Overview'],
                    ['outline', 'Outline'],
                    ['resources', 'Resources'],
                    ['assignments', 'Assignments'],
                    ['quizzes', 'Quizzes'],
                    ['tests', 'Tests'],
                    ['lesson_plans', 'Lesson plans'],
                    ['announcements', 'Announcements'],
                  ] as Array<[keyof ActualCourseSiteConfig, string]>
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-3 text-sm text-text-default">
                    <input
                      type="checkbox"
                      checked={typeof actualSiteConfig[key] === 'boolean' ? (actualSiteConfig[key] as boolean) : false}
                      onChange={(e) =>
                        setActualSiteConfig((current) => ({
                          ...current,
                          [key]: e.target.checked,
                        }))
                      }
                      disabled={siteSaving || isReadOnly}
                      className="h-4 w-4"
                    />
                    {label}
                  </label>
                ))}
              </div>

              <div>
                <label className="mb-2 block text-sm text-text-muted">Lesson plan visibility on website</label>
                <select
                  value={actualSiteConfig.lesson_plan_scope}
                  onChange={(e) =>
                    setActualSiteConfig((current) => ({
                      ...current,
                      lesson_plan_scope: e.target.value as ActualCourseSiteConfig['lesson_plan_scope'],
                    }))
                  }
                  disabled={siteSaving || isReadOnly}
                  className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="current_week">Current week (and earlier)</option>
                  <option value="one_week_ahead">One week ahead</option>
                  <option value="all">All lesson plans</option>
                </select>
              </div>

              <div>
                <label htmlFor={actualOverviewId} className="mb-2 block text-sm text-text-muted">
                  Website overview
                </label>
                <textarea
                  id={actualOverviewId}
                  value={courseOverviewMarkdown}
                  onChange={(e) => setCourseOverviewMarkdown(e.target.value)}
                  disabled={siteSaving || isReadOnly}
                  className="min-h-[140px] w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor={actualOutlineId} className="mb-2 block text-sm text-text-muted">
                  Website outline
                </label>
                <textarea
                  id={actualOutlineId}
                  value={courseOutlineMarkdown}
                  onChange={(e) => setCourseOutlineMarkdown(e.target.value)}
                  disabled={siteSaving || isReadOnly}
                  className="min-h-[160px] w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {actualSitePublished && actualSiteSlug ? (
                <div className="text-sm text-text-muted">
                  Actual site URL:{' '}
                  <a
                    href={`/actual/${actualSiteSlug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    {`/actual/${actualSiteSlug}`}
                  </a>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={saveActualSiteSettings} disabled={siteSaving || isReadOnly}>
                  {siteSaving ? 'Saving…' : 'Save Website Settings'}
                </Button>
              </div>

              {siteError && <div className="text-sm text-danger">{siteError}</div>}
              {siteSuccess && <div className="text-sm text-success">{siteSuccess}</div>}
            </div>

            <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-text-default">Course Reuse</div>
                <Tooltip content="Create a reusable blueprint draft from this classroom’s teacher-authored course content" side="right">
                  <span className="text-text-muted cursor-help">
                    <Info size={14} />
                  </span>
                </Tooltip>
              </div>

              <p className="text-sm text-text-muted">
                Turn this classroom’s overview, outline, resources, assignments, assessments, and lesson plans into a reusable course blueprint.
              </p>

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={openCreateBlueprintDialog}
                  disabled={blueprintBusy || isReadOnly}
                >
                  {blueprintBusy ? 'Working…' : 'Create Classroom Blueprint'}
                </Button>
              </div>
            </div>

            <ConfirmDialog
              isOpen={showRegenerateConfirm}
              title="Generate new join code?"
              description="This replaces the current code. Students will need the new code/link to join."
              confirmLabel={isRegenerating ? 'Generating…' : 'New code'}
              cancelLabel="Cancel"
              confirmVariant="danger"
              isConfirmDisabled={isRegenerating || isReadOnly}
              isCancelDisabled={isRegenerating || isReadOnly}
              onCancel={() => (isRegenerating || isReadOnly ? null : setShowRegenerateConfirm(false))}
              onConfirm={regenerateJoinCode}
            />

            <DialogPanel
              isOpen={showCreateBlueprintDialog}
              onClose={closeCreateBlueprintDialog}
              maxWidth="max-w-xl"
              className="p-6"
              ariaLabelledBy="create-classroom-blueprint-title"
            >
              <h2 id="create-classroom-blueprint-title" className="mb-4 text-xl font-bold text-text-default">
                Create Classroom Blueprint
              </h2>

              <div className="space-y-4">
                <FormField label="Blueprint Title" required>
                  <Input
                    value={blueprintTitle}
                    onChange={(e) => setBlueprintTitle(e.target.value)}
                    disabled={blueprintBusy}
                    placeholder="Grade 11 Computer Science"
                  />
                </FormField>

                <div className="rounded-md border border-border bg-surface-2 px-4 py-3 text-sm text-text-muted">
                  This copies the classroom overview, outline, resources, assignments, quizzes, tests, and lesson plans into a new reusable blueprint draft. Students, submissions, grades, and attendance are not included.
                </div>

                {blueprintError ? (
                  <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
                    {blueprintError}
                  </div>
                ) : null}
              </div>

              <div className="mt-6 flex gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={closeCreateBlueprintDialog}
                  className="flex-1"
                  disabled={blueprintBusy}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={createBlueprintFromClassroom}
                  className="flex-1"
                  disabled={blueprintBusy || !blueprintTitle.trim()}
                >
                  {blueprintBusy ? 'Creating…' : 'Create Blueprint'}
                </Button>
              </div>
            </DialogPanel>
          </PageContent>
      ) : (
        <PageContent>
          <TeacherCalendarTab classroom={classroom} />
        </PageContent>
      )}
    </PageLayout>
  )
}
