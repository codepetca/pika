'use client'

import { forwardRef, useMemo, useState, useId, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { useRouter } from 'next/navigation'
import { Info } from 'lucide-react'
import {
  Button,
  Card,
  ConfirmDialog,
  DialogPanel,
  FormField,
  Input,
  SegmentedControl,
  Select,
  Tooltip,
  cn,
  useAppMessage,
} from '@/ui'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { useMarkdownPreference } from '@/contexts/MarkdownPreferenceContext'
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

const SETTINGS_SECTION_OPTIONS: Array<{ value: SettingsSection; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'class-days', label: 'Class Days' },
]

const LESSON_PLAN_VISIBILITY_OPTIONS = [
  { value: 'current_week', label: 'Current week (and all previous)' },
  { value: 'one_week_ahead', label: '1 week ahead' },
  { value: 'all', label: 'All (no restrictions)' },
]

const SYLLABUS_LESSON_PLAN_SCOPE_OPTIONS = [
  { value: 'current_week', label: 'Current week (and earlier)' },
  { value: 'one_week_ahead', label: 'One week ahead' },
  { value: 'all', label: 'All lesson plans' },
]

function visibleActualSiteConfig(config: ActualCourseSiteConfig | null | undefined): ActualCourseSiteConfig {
  return {
    ...(config || DEFAULT_ACTUAL_COURSE_SITE_CONFIG),
    quizzes: false,
  }
}

interface Props {
  classroom: Classroom
  sectionParam?: string | null
  onSectionChange?: (section: SettingsSection) => void
}

function SettingsPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card padding="md" className={cn('space-y-3 shadow-none', className)}>
      {children}
    </Card>
  )
}

function SettingsHeading({ title, tooltip }: { title: string; tooltip?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="text-sm font-semibold text-text-default">{title}</div>
      {tooltip ? (
        <Tooltip content={tooltip} side="right">
          <span className="text-text-muted cursor-help">
            <Info size={14} />
          </span>
        </Tooltip>
      ) : null}
    </div>
  )
}

interface SettingsTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean
}

const SettingsTextarea = forwardRef<HTMLTextAreaElement, SettingsTextareaProps>(function SettingsTextarea(
  { hasError, className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-control border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary disabled:bg-surface-2 disabled:cursor-not-allowed',
        hasError ? 'border-danger' : 'border-border',
        className,
      )}
      {...props}
    />
  )
})

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
  const actualLessonPlanScopeId = useId()
  const showMarkdownId = useId()
  const isReadOnly = !!classroom.archived_at
  const { showMarkdown, mounted: markdownMounted, setShowMarkdown } = useMarkdownPreference()
  const [title, setTitle] = useState(classroom.title)
  const [titleSaving, setTitleSaving] = useState(false)
  const [titleError, setTitleError] = useState<string>('')
  const [joinCode, setJoinCode] = useState(classroom.class_code)
  const [allowEnrollment, setAllowEnrollment] = useState<boolean>(classroom.allow_enrollment)
  const [saving, setSaving] = useState(false)
  const [enrollmentError, setEnrollmentError] = useState<string>('')
  const [joinCodeError, setJoinCodeError] = useState<string>('')
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [lessonPlanVisibility, setLessonPlanVisibility] = useState<LessonPlanVisibility>(
    classroom.lesson_plan_visibility || 'current_week'
  )
  const [visibilityError, setVisibilityError] = useState<string>('')
  const [visibilitySaving, setVisibilitySaving] = useState(false)
  const visibilityId = useId()
  const [actualSiteSlug, setActualSiteSlug] = useState(classroom.actual_site_slug || '')
  const [actualSitePublished, setActualSitePublished] = useState(!!classroom.actual_site_published)
  const [actualSiteConfig, setActualSiteConfig] = useState<ActualCourseSiteConfig>(
    visibleActualSiteConfig(classroom.actual_site_config)
  )
  const [courseOverviewMarkdown, setCourseOverviewMarkdown] = useState(classroom.course_overview_markdown || '')
  const [courseOutlineMarkdown, setCourseOutlineMarkdown] = useState(classroom.course_outline_markdown || '')
  const [siteSaving, setSiteSaving] = useState(false)
  const [siteError, setSiteError] = useState('')
  const [showCreateBlueprintDialog, setShowCreateBlueprintDialog] = useState(false)
  const [blueprintTitle, setBlueprintTitle] = useState(classroom.title)
  const [blueprintBusy, setBlueprintBusy] = useState(false)
  const [blueprintError, setBlueprintError] = useState('')

  const origin = useMemo(() => {
    if (typeof window === 'undefined') return ''
    return window.location.origin
  }, [])
  const joinLink = `${origin}/join/${joinCode}`
  const { showMessage } = useAppMessage()

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore clipboard failures
    }
  }

  async function copyWithNotice(label: string, text: string) {
    await copy(text)
    showMessage({ text: `${label} copied`, tone: 'success' })
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
      showMessage({ text: 'Course name updated', tone: 'success' })
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
      showMessage({ text: 'Settings saved', tone: 'success' })
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
      showMessage({ text: 'Join code regenerated', tone: 'success' })
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
      showMessage({ text: 'Visibility updated', tone: 'success' })
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
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualSiteSlug: actualSiteSlug || null,
          actualSitePublished,
          actualSiteConfig: visibleActualSiteConfig(actualSiteConfig),
          courseOverviewMarkdown,
          courseOutlineMarkdown,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save syllabus settings')
      }
      setActualSiteSlug(data.classroom?.actual_site_slug || '')
      setActualSitePublished(!!data.classroom?.actual_site_published)
      setActualSiteConfig(visibleActualSiteConfig(data.classroom?.actual_site_config || actualSiteConfig))
      setCourseOverviewMarkdown(data.classroom?.course_overview_markdown || courseOverviewMarkdown)
      setCourseOutlineMarkdown(data.classroom?.course_outline_markdown || courseOutlineMarkdown)
      showMessage({ text: 'Syllabus settings saved', tone: 'success' })
    } catch (err: any) {
      setSiteError(err.message || 'Failed to save syllabus settings')
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
        throw new Error(data.error || 'Failed to save classroom as a course blueprint')
      }
      router.push(data.redirect_url || `/teacher/blueprints?blueprint=${data.blueprint_id}&fromClassroom=${classroom.id}`)
    } catch (err: any) {
      setBlueprintError(err.message || 'Failed to save classroom as a course blueprint')
    } finally {
      setBlueprintBusy(false)
    }
  }

  return (
    <PageLayout>
      <div className="mb-2">
        <SegmentedControl
          ariaLabel="Settings section"
          value={section}
          options={SETTINGS_SECTION_OPTIONS}
          onChange={onSectionChange}
          className="[&_button]:min-h-11"
        />
      </div>

      {section === 'general' ? (
        <PageContent className="space-y-4 pt-0">
          <SettingsPanel>
            <SettingsHeading title="Course Name" tooltip="Name shown to students and in reports" />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <FormField label="Course Name" htmlFor={titleId} hideLabel error={titleError} className="flex-1">
                <Input
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
                  placeholder="Enter course name"
                />
              </FormField>
              {titleSaving && <span className="text-sm text-text-muted sm:pt-2">Saving...</span>}
            </div>
          </SettingsPanel>

          <SettingsPanel>
            <SettingsHeading title="Join Code" tooltip="Students must be on the roster to join" />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => copyWithNotice('Join code', joinCode)}
                aria-label="Copy join code"
                className="w-full justify-start font-mono text-base font-semibold sm:w-auto"
              >
                {joinCode}
              </Button>

              <Button
                variant="secondary"
                onClick={() => setShowRegenerateConfirm(true)}
                disabled={isRegenerating || isReadOnly}
                className="w-full sm:w-auto"
              >
                {isRegenerating ? 'Generating...' : 'New code'}
              </Button>

              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => copyWithNotice('Join link', joinLink)}
                aria-label="Copy join link"
                title={joinLink}
                className="w-full min-w-0 justify-start font-mono text-xs sm:flex-1"
              >
                <span className="min-w-0 truncate">{joinLink}</span>
              </Button>
            </div>

            <div className="flex items-center gap-3 border-t border-border pt-2">
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
            {enrollmentError && <div className="text-sm text-danger">{enrollmentError}</div>}
          </SettingsPanel>

          <SettingsPanel>
            <SettingsHeading title="Calendar Visibility" tooltip="Control how far ahead students can see lesson plans" />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <FormField label="Calendar visibility" htmlFor={visibilityId} hideLabel error={visibilityError} className="sm:max-w-md">
                <Select
                  options={LESSON_PLAN_VISIBILITY_OPTIONS}
                  value={lessonPlanVisibility}
                  onChange={(e) => saveLessonPlanVisibility(e.target.value as LessonPlanVisibility)}
                  disabled={visibilitySaving || isReadOnly}
                />
              </FormField>
              {visibilitySaving && <span className="text-sm text-text-muted sm:pt-2">Saving...</span>}
            </div>
          </SettingsPanel>

          <SettingsPanel>
            <div className="text-sm font-semibold text-text-default">Display</div>

            <label htmlFor={showMarkdownId} className="flex items-center gap-3 text-sm text-text-default">
              <input
                id={showMarkdownId}
                type="checkbox"
                checked={markdownMounted ? showMarkdown : true}
                onChange={(event) => setShowMarkdown(event.target.checked)}
                className="h-4 w-4"
              />
              Show markdown
            </label>
          </SettingsPanel>

          <SettingsPanel className="space-y-4">
            <SettingsHeading title="Public Syllabus" tooltip="Publish the public syllabus page for this classroom" />

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto]">
              <FormField label="Syllabus slug" htmlFor={actualSiteSlugId}>
                <Input
                  value={actualSiteSlug}
                  onChange={(e) => setActualSiteSlug(slugifyCourseSiteValue(e.target.value))}
                  disabled={siteSaving || isReadOnly}
                  placeholder="career-studies-period-1"
                />
              </FormField>
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
              Publish this classroom syllabus
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              {(
                [
                  ['overview', 'Overview'],
                  ['outline', 'Outline'],
                  ['assignments', 'Assignments'],
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

            <FormField label="Lesson plan visibility on syllabus" htmlFor={actualLessonPlanScopeId}>
              <Select
                options={SYLLABUS_LESSON_PLAN_SCOPE_OPTIONS}
                value={actualSiteConfig.lesson_plan_scope}
                onChange={(e) =>
                  setActualSiteConfig((current) => ({
                    ...current,
                    lesson_plan_scope: e.target.value as ActualCourseSiteConfig['lesson_plan_scope'],
                  }))
                }
                disabled={siteSaving || isReadOnly}
              />
            </FormField>

            {showMarkdown ? (
              <>
                <FormField label="Course overview" htmlFor={actualOverviewId}>
                  <SettingsTextarea
                    value={courseOverviewMarkdown}
                    onChange={(e) => setCourseOverviewMarkdown(e.target.value)}
                    disabled={siteSaving || isReadOnly}
                    className="min-h-[140px] font-mono"
                  />
                </FormField>

                <FormField label="Course outline" htmlFor={actualOutlineId}>
                  <SettingsTextarea
                    value={courseOutlineMarkdown}
                    onChange={(e) => setCourseOutlineMarkdown(e.target.value)}
                    disabled={siteSaving || isReadOnly}
                    className="min-h-[160px] font-mono"
                  />
                </FormField>
              </>
            ) : (
              <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-muted">
                Course overview and outline editing is hidden by your display setting.
              </div>
            )}

            {actualSitePublished && actualSiteSlug ? (
              <div className="text-sm text-text-muted">
                Syllabus URL:{' '}
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
                {siteSaving ? 'Saving...' : 'Save Syllabus'}
              </Button>
            </div>

            {siteError && <div className="text-sm text-danger">{siteError}</div>}
          </SettingsPanel>

          <SettingsPanel>
            <SettingsHeading
              title="Course Blueprint"
              tooltip="Save this classroom's teacher-authored course content as a reusable course blueprint"
            />

            <p className="text-sm text-text-muted">
              Save the classroom overview, outline, resources, assignments, tests, and lesson plans as a reusable course blueprint. Students, submissions, grades, and attendance stay out of the blueprint.
            </p>

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={openCreateBlueprintDialog}
                disabled={blueprintBusy || isReadOnly}
              >
                {blueprintBusy ? 'Working...' : 'Save as Course Blueprint'}
              </Button>
            </div>
          </SettingsPanel>

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
                Save Classroom as Course Blueprint
              </h2>

              <div className="space-y-4">
                <FormField label="Course Blueprint Title" required>
                  <Input
                    value={blueprintTitle}
                    onChange={(e) => setBlueprintTitle(e.target.value)}
                    disabled={blueprintBusy}
                    placeholder="Grade 11 Computer Science"
                  />
                </FormField>

                <div className="rounded-md border border-border bg-surface-2 px-4 py-3 text-sm text-text-muted">
                  The course blueprint will include teacher-authored course content only. Students, submissions, grades, attendance, join codes, and roster data are not included.
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
                  {blueprintBusy ? 'Saving...' : 'Save Blueprint'}
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
