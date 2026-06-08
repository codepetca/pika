'use client'

import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Info, RefreshCw } from 'lucide-react'
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
import { invalidateTeacherClassrooms } from '@/lib/teacher-classrooms-client'
import { TeacherCalendarTab } from './TeacherCalendarTab'
import type { ActualCourseSiteConfig, Classroom, ClassroomJoinPolicy, LessonPlanVisibility } from '@/types'

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

function SettingsHeading({ title, tooltip }: { title: string; tooltip?: ReactNode }) {
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

function SettingsSwitch({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-7 w-14 shrink-0 rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-page',
        disabled
          ? 'cursor-not-allowed border-border bg-surface-2'
          : checked
            ? 'hover:border-primary-hover hover:bg-info-bg-hover'
            : 'hover:bg-surface-hover',
        !disabled && (checked ? 'border-primary bg-info-bg' : 'border-border bg-surface-2'),
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0 top-1 h-5 w-5 rounded-full shadow-sm transition-transform',
          checked ? 'translate-x-7' : 'translate-x-1',
          'bg-primary',
        )}
      />
    </button>
  )
}

function SettingsSwitchRow({
  checked,
  onChange,
  disabled,
  ariaLabel,
  children,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  ariaLabel: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <SettingsSwitch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={ariaLabel} />
      <div className={cn('min-w-0 text-sm', disabled ? 'text-text-muted' : 'text-text-default')}>{children}</div>
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
  const titleId = useId()
  const actualSiteSlugId = useId()
  const actualOverviewId = useId()
  const actualOutlineId = useId()
  const actualLessonPlanScopeId = useId()
  const isReadOnly = !!classroom.archived_at
  const activeClassroomIdRef = useRef(classroom.id)
  const formClassroomIdRef = useRef(classroom.id)
  const formGenerationRef = useRef(0)
  activeClassroomIdRef.current = classroom.id
  const { showMarkdown, mounted: markdownMounted, setShowMarkdown } = useMarkdownPreference()
  const [title, setTitle] = useState(classroom.title)
  const [titleSaving, setTitleSaving] = useState(false)
  const [titleError, setTitleError] = useState<string>('')
  const [joinCode, setJoinCode] = useState(classroom.class_code)
  const [allowEnrollment, setAllowEnrollment] = useState<boolean>(classroom.allow_enrollment)
  const [joinPolicy, setJoinPolicy] = useState<ClassroomJoinPolicy>(classroom.join_policy || 'roster')
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
  const { showMessage } = useAppMessage()
  const formStateReady = formClassroomIdRef.current === classroom.id
  const displayedTitle = formStateReady ? title : classroom.title
  const displayedTitleSaving = formStateReady && titleSaving
  const displayedTitleError = formStateReady ? titleError : ''
  const displayedJoinCode = formStateReady ? joinCode : classroom.class_code
  const displayedAllowEnrollment = formStateReady ? allowEnrollment : classroom.allow_enrollment
  const displayedJoinPolicy = formStateReady ? joinPolicy : classroom.join_policy || 'roster'
  const displayedSaving = formStateReady && saving
  const displayedEnrollmentError = formStateReady ? enrollmentError : ''
  const displayedJoinCodeError = formStateReady ? joinCodeError : ''
  const displayedShowRegenerateConfirm = formStateReady && showRegenerateConfirm
  const displayedIsRegenerating = formStateReady && isRegenerating
  const displayedLessonPlanVisibility = formStateReady
    ? lessonPlanVisibility
    : classroom.lesson_plan_visibility || 'current_week'
  const displayedVisibilitySaving = formStateReady && visibilitySaving
  const displayedVisibilityError = formStateReady ? visibilityError : ''
  const displayedActualSiteSlug = formStateReady ? actualSiteSlug : classroom.actual_site_slug || ''
  const displayedActualSitePublished = formStateReady
    ? actualSitePublished
    : !!classroom.actual_site_published
  const displayedActualSiteConfig = formStateReady
    ? actualSiteConfig
    : visibleActualSiteConfig(classroom.actual_site_config)
  const displayedCourseOverviewMarkdown = formStateReady
    ? courseOverviewMarkdown
    : classroom.course_overview_markdown || ''
  const displayedCourseOutlineMarkdown = formStateReady
    ? courseOutlineMarkdown
    : classroom.course_outline_markdown || ''
  const displayedSiteSaving = formStateReady && siteSaving
  const displayedSiteError = formStateReady ? siteError : ''
  const displayedShowCreateBlueprintDialog = formStateReady && showCreateBlueprintDialog
  const displayedBlueprintTitle = formStateReady ? blueprintTitle : classroom.title
  const displayedBlueprintBusy = formStateReady && blueprintBusy
  const displayedBlueprintError = formStateReady ? blueprintError : ''
  const joinLink = `${origin}/join/${displayedJoinCode}`

  useEffect(() => {
    formClassroomIdRef.current = classroom.id
    formGenerationRef.current += 1
    setTitle(classroom.title)
    setTitleSaving(false)
    setTitleError('')
    setJoinCode(classroom.class_code)
    setAllowEnrollment(classroom.allow_enrollment)
    setJoinPolicy(classroom.join_policy || 'roster')
    setSaving(false)
    setEnrollmentError('')
    setJoinCodeError('')
    setShowRegenerateConfirm(false)
    setIsRegenerating(false)
    setLessonPlanVisibility(classroom.lesson_plan_visibility || 'current_week')
    setVisibilityError('')
    setVisibilitySaving(false)
    setActualSiteSlug(classroom.actual_site_slug || '')
    setActualSitePublished(!!classroom.actual_site_published)
    setActualSiteConfig(visibleActualSiteConfig(classroom.actual_site_config))
    setCourseOverviewMarkdown(classroom.course_overview_markdown || '')
    setCourseOutlineMarkdown(classroom.course_outline_markdown || '')
    setSiteSaving(false)
    setSiteError('')
    setShowCreateBlueprintDialog(false)
    setBlueprintTitle(classroom.title)
    setBlueprintBusy(false)
    setBlueprintError('')
    // Only reset on classroom switches. Same-classroom prop refreshes should not wipe in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroom.id])

  function isActiveClassroom(classroomId: string) {
    return activeClassroomIdRef.current === classroomId
  }

  function hasCurrentFormState(classroomId: string) {
    return formClassroomIdRef.current === classroomId
  }

  function isCurrentFormGeneration(classroomId: string, generation: number) {
    return isActiveClassroom(classroomId) && formGenerationRef.current === generation
  }

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
    const classroomId = classroom.id
    if (!hasCurrentFormState(classroomId)) return
    const formGeneration = formGenerationRef.current
    const trimmed = title.trim()
    if (!trimmed) {
      setTitleError('Classroom name cannot be empty')
      return
    }
    if (trimmed === classroom.title) {
      return
    }
    setTitleSaving(true)
    setTitleError('')
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update classroom name')
      }
      invalidateTeacherClassrooms()
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      setTitle(data.classroom?.title || trimmed)
      showMessage({ text: 'Classroom name updated', tone: 'success' })
    } catch (err: any) {
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      setTitleError(err.message || 'Failed to update classroom name')
    } finally {
      if (isCurrentFormGeneration(classroomId, formGeneration)) {
        setTitleSaving(false)
      }
    }
  }

  async function saveAllowEnrollment(nextValue: boolean) {
    if (isReadOnly) return
    const classroomId = classroom.id
    if (!hasCurrentFormState(classroomId)) return
    const formGeneration = formGenerationRef.current
    setSaving(true)
    setEnrollmentError('')
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowEnrollment: nextValue }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update settings')
      }
      invalidateTeacherClassrooms()
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      setAllowEnrollment(!!data.classroom?.allow_enrollment)
      showMessage({ text: 'Settings saved', tone: 'success' })
    } catch (err: any) {
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      setEnrollmentError(err.message || 'Failed to update settings')
    } finally {
      if (isCurrentFormGeneration(classroomId, formGeneration)) {
        setSaving(false)
      }
    }
  }

  async function saveJoinPolicy(nextValue: ClassroomJoinPolicy) {
    if (isReadOnly || nextValue === joinPolicy) return
    const classroomId = classroom.id
    if (!hasCurrentFormState(classroomId)) return
    const formGeneration = formGenerationRef.current
    setSaving(true)
    setEnrollmentError('')
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joinPolicy: nextValue }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update settings')
      }
      invalidateTeacherClassrooms()
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      setJoinPolicy(data.classroom?.join_policy || nextValue)
      showMessage({ text: 'Settings saved', tone: 'success' })
    } catch (err: any) {
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      setEnrollmentError(err.message || 'Failed to update settings')
    } finally {
      if (isCurrentFormGeneration(classroomId, formGeneration)) {
        setSaving(false)
      }
    }
  }

  async function regenerateJoinCode() {
    if (isReadOnly) return
    const classroomId = classroom.id
    if (!hasCurrentFormState(classroomId)) return
    const formGeneration = formGenerationRef.current
    setIsRegenerating(true)
    setJoinCodeError('')
    try {
      const newCode = generateJoinCode()
      const res = await fetch(`/api/teacher/classrooms/${classroomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classCode: newCode }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to regenerate join code')
      }
      invalidateTeacherClassrooms()
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      setJoinCode(data.classroom?.class_code || newCode)
      showMessage({ text: 'Join code regenerated', tone: 'success' })
    } catch (err: any) {
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      setJoinCodeError(err.message || 'Failed to regenerate join code')
    } finally {
      if (isCurrentFormGeneration(classroomId, formGeneration)) {
        setIsRegenerating(false)
        setShowRegenerateConfirm(false)
      }
    }
  }

  async function saveLessonPlanVisibility(value: LessonPlanVisibility) {
    if (isReadOnly) return
    const classroomId = classroom.id
    if (!hasCurrentFormState(classroomId)) return
    const formGeneration = formGenerationRef.current
    setVisibilitySaving(true)
    setVisibilityError('')
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonPlanVisibility: value }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update visibility setting')
      }
      invalidateTeacherClassrooms()
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      setLessonPlanVisibility(data.classroom?.lesson_plan_visibility || value)
      showMessage({ text: 'Visibility updated', tone: 'success' })
    } catch (err: any) {
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      setVisibilityError(err.message || 'Failed to update visibility setting')
    } finally {
      if (isCurrentFormGeneration(classroomId, formGeneration)) {
        setVisibilitySaving(false)
      }
    }
  }

  async function saveActualSiteSettings() {
    if (isReadOnly) return
    const classroomId = classroom.id
    if (!hasCurrentFormState(classroomId)) return
    const formGeneration = formGenerationRef.current
    setSiteSaving(true)
    setSiteError('')
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroomId}`, {
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
      invalidateTeacherClassrooms()
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      setActualSiteSlug(data.classroom?.actual_site_slug || '')
      setActualSitePublished(!!data.classroom?.actual_site_published)
      setActualSiteConfig(visibleActualSiteConfig(data.classroom?.actual_site_config || actualSiteConfig))
      setCourseOverviewMarkdown(data.classroom?.course_overview_markdown || courseOverviewMarkdown)
      setCourseOutlineMarkdown(data.classroom?.course_outline_markdown || courseOutlineMarkdown)
      showMessage({ text: 'Syllabus settings saved', tone: 'success' })
    } catch (err: any) {
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      setSiteError(err.message || 'Failed to save syllabus settings')
    } finally {
      if (isCurrentFormGeneration(classroomId, formGeneration)) {
        setSiteSaving(false)
      }
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
    const classroomId = classroom.id
    if (!hasCurrentFormState(classroomId)) return
    const formGeneration = formGenerationRef.current
    setBlueprintBusy(true)
    setBlueprintError('')
    try {
      const response = await fetch(`/api/teacher/classrooms/${classroomId}/blueprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: blueprintTitle.trim() || classroom.title }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save classroom as a course blueprint')
      }
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      router.push(data.redirect_url || `/teacher/blueprints?blueprint=${data.blueprint_id}&fromClassroom=${classroomId}`)
    } catch (err: any) {
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      setBlueprintError(err.message || 'Failed to save classroom as a course blueprint')
    } finally {
      if (isCurrentFormGeneration(classroomId, formGeneration)) {
        setBlueprintBusy(false)
      }
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
            <SettingsHeading title="Classroom name" tooltip="Name shown to students and in reports" />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <FormField label="Classroom name" htmlFor={titleId} hideLabel error={displayedTitleError} className="flex-1">
                <Input
                  type="text"
                  value={displayedTitle}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      saveTitle()
                    }
                  }}
                  disabled={displayedTitleSaving || isReadOnly || !formStateReady}
                  placeholder="Enter classroom name"
                />
              </FormField>
              {displayedTitleSaving && <span className="text-sm text-text-muted sm:pt-2">Saving...</span>}
            </div>
          </SettingsPanel>

          <SettingsPanel>
            <SettingsHeading
              title="Joining"
              tooltip="Control new joins and whether students must be on the roster."
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
              <Button
                type="button"
                variant="subtle"
                size="md"
                onClick={() => copyWithNotice('Join code', displayedJoinCode)}
                aria-label="Copy join code"
                disabled={!formStateReady}
                className="w-full justify-start font-mono text-base font-semibold sm:w-auto"
              >
                {displayedJoinCode}
              </Button>

              <Button
                type="button"
                variant="subtle"
                size="md"
                onClick={() => copyWithNotice('Join link', joinLink)}
                aria-label="Copy join link"
                title={joinLink}
                disabled={!formStateReady}
                className="w-full min-w-0 justify-start font-mono text-xs sm:w-[30rem] sm:max-w-[45vw]"
              >
                <span className="min-w-0 truncate">{joinLink}</span>
              </Button>

              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setShowRegenerateConfirm(true)}
                disabled={isRegenerating || isReadOnly || !formStateReady}
                aria-label="Generate new join code and link"
                title="Generate new join code and link"
                className="h-11 w-11 shrink-0 border-warning bg-warning-bg px-0 text-warning hover:bg-warning-bg focus:ring-warning"
              >
                <RefreshCw className={cn('h-4 w-4', isRegenerating ? 'animate-spin' : '')} aria-hidden="true" />
              </Button>
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <SettingsSwitchRow
                  checked={displayedAllowEnrollment}
                  onChange={saveAllowEnrollment}
                  disabled={displayedSaving || isReadOnly || !formStateReady}
                  ariaLabel="Allow new students to join"
                >
                  <span className="font-medium">{displayedAllowEnrollment ? 'Allow new joins' : 'Disallow new joins'}</span>
                </SettingsSwitchRow>
                {displayedSaving && <span className="text-sm text-text-muted">Saving...</span>}
              </div>
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <SettingsSwitchRow
                checked={displayedJoinPolicy === 'roster'}
                onChange={(isRoster) => saveJoinPolicy(isRoster ? 'roster' : 'open_join')}
                disabled={displayedSaving || isReadOnly || !displayedAllowEnrollment || !formStateReady}
                ariaLabel="Join mode"
              >
                {displayedJoinPolicy === 'roster' ? (
                  <>
                    <span className="font-medium text-text-default">Only students on roster can join.</span>{' '}
                    <Link href={`/classrooms/${classroom.id}?tab=roster`} className="text-primary underline">
                      view roster
                    </Link>
                  </>
                ) : (
                  <span className="font-medium text-text-default">Open join via code/link.</span>
                )}
              </SettingsSwitchRow>

              {displayedAllowEnrollment && displayedJoinPolicy === 'open_join' ? (
                <div className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
                  Anyone with this code or link can join after entering their name.
                </div>
              ) : null}
            </div>

            {displayedJoinCodeError && <div className="text-sm text-danger">{displayedJoinCodeError}</div>}
            {displayedEnrollmentError && <div className="text-sm text-danger">{displayedEnrollmentError}</div>}
          </SettingsPanel>

          <SettingsPanel>
            <SettingsHeading title="Calendar Visibility" tooltip="Control how far ahead students can see lesson plans" />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <FormField label="Calendar visibility" htmlFor={visibilityId} hideLabel error={displayedVisibilityError} className="sm:max-w-md">
                <Select
                  options={LESSON_PLAN_VISIBILITY_OPTIONS}
                  value={displayedLessonPlanVisibility}
                  onChange={(e) => saveLessonPlanVisibility(e.target.value as LessonPlanVisibility)}
                  disabled={displayedVisibilitySaving || isReadOnly || !formStateReady}
                />
              </FormField>
              {displayedVisibilitySaving && <span className="text-sm text-text-muted sm:pt-2">Saving...</span>}
            </div>
          </SettingsPanel>

          <SettingsPanel>
            <div className="text-sm font-semibold text-text-default">Display</div>

            <SettingsSwitchRow
              checked={markdownMounted ? showMarkdown : true}
              onChange={setShowMarkdown}
              ariaLabel="Show markdown"
            >
              <span className="font-medium">Show markdown</span>
            </SettingsSwitchRow>
          </SettingsPanel>

          <SettingsPanel className="space-y-4">
            <SettingsHeading title="Public Syllabus" tooltip="Publish the public syllabus page for this classroom" />

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto]">
              <FormField label="Syllabus slug" htmlFor={actualSiteSlugId}>
                <Input
                  value={displayedActualSiteSlug}
                  onChange={(e) => setActualSiteSlug(slugifyCourseSiteValue(e.target.value))}
                  disabled={displayedSiteSaving || isReadOnly || !formStateReady}
                  placeholder="career-studies-period-1"
                />
              </FormField>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={displayedSiteSaving || isReadOnly || !formStateReady}
                  onClick={() => setActualSiteSlug(slugifyCourseSiteValue(title || classroom.title))}
                >
                  Generate
                </Button>
              </div>
            </div>

            <SettingsSwitchRow
              checked={displayedActualSitePublished}
              onChange={setActualSitePublished}
              disabled={displayedSiteSaving || isReadOnly || !formStateReady}
              ariaLabel="Publish this classroom syllabus"
            >
              <span className="font-medium">Publish this classroom syllabus</span>
            </SettingsSwitchRow>

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
              ).map(([key, label]) => {
                const checked = typeof displayedActualSiteConfig[key] === 'boolean'
                  ? (displayedActualSiteConfig[key] as boolean)
                  : false

                return (
                  <SettingsSwitchRow
                    key={key}
                    checked={checked}
                    onChange={(nextChecked) =>
                      setActualSiteConfig((current) => ({
                        ...current,
                        [key]: nextChecked,
                      }))
                    }
                    disabled={displayedSiteSaving || isReadOnly || !formStateReady}
                    ariaLabel={label}
                  >
                    <span className={checked ? 'font-medium' : undefined}>{label}</span>
                  </SettingsSwitchRow>
                )
              })}
            </div>

            <FormField label="Lesson plan visibility on syllabus" htmlFor={actualLessonPlanScopeId}>
              <Select
                options={SYLLABUS_LESSON_PLAN_SCOPE_OPTIONS}
                value={displayedActualSiteConfig.lesson_plan_scope}
                onChange={(e) =>
                  setActualSiteConfig((current) => ({
                    ...current,
                    lesson_plan_scope: e.target.value as ActualCourseSiteConfig['lesson_plan_scope'],
                  }))
                }
                disabled={displayedSiteSaving || isReadOnly || !formStateReady}
              />
            </FormField>

            {showMarkdown ? (
              <>
                <FormField label="Course overview" htmlFor={actualOverviewId}>
                  <SettingsTextarea
                    value={displayedCourseOverviewMarkdown}
                    onChange={(e) => setCourseOverviewMarkdown(e.target.value)}
                    disabled={displayedSiteSaving || isReadOnly || !formStateReady}
                    className="min-h-[140px] font-mono"
                  />
                </FormField>

                <FormField label="Course outline" htmlFor={actualOutlineId}>
                  <SettingsTextarea
                    value={displayedCourseOutlineMarkdown}
                    onChange={(e) => setCourseOutlineMarkdown(e.target.value)}
                    disabled={displayedSiteSaving || isReadOnly || !formStateReady}
                    className="min-h-[160px] font-mono"
                  />
                </FormField>
              </>
            ) : (
              <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-muted">
                Course overview and outline editing is hidden by your display setting.
              </div>
            )}

            {displayedActualSitePublished && displayedActualSiteSlug ? (
              <div className="text-sm text-text-muted">
                Syllabus URL:{' '}
                <a
                  href={`/actual/${displayedActualSiteSlug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  {`/actual/${displayedActualSiteSlug}`}
                </a>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button type="button" onClick={saveActualSiteSettings} disabled={displayedSiteSaving || isReadOnly || !formStateReady}>
                {displayedSiteSaving ? 'Saving...' : 'Save Syllabus'}
              </Button>
            </div>

            {displayedSiteError && <div className="text-sm text-danger">{displayedSiteError}</div>}
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
                disabled={displayedBlueprintBusy || isReadOnly || !formStateReady}
              >
                {displayedBlueprintBusy ? 'Working...' : 'Save as Course Blueprint'}
              </Button>
            </div>
          </SettingsPanel>

            <ConfirmDialog
              isOpen={displayedShowRegenerateConfirm}
              title="Generate new join code and link?"
              confirmLabel={displayedIsRegenerating ? 'Generating...' : 'Generate'}
              cancelLabel="Cancel"
              confirmVariant="danger"
              isConfirmDisabled={displayedIsRegenerating || isReadOnly}
              isCancelDisabled={displayedIsRegenerating || isReadOnly}
              onCancel={() => (displayedIsRegenerating || isReadOnly ? null : setShowRegenerateConfirm(false))}
              onConfirm={regenerateJoinCode}
            />

            <DialogPanel
              isOpen={displayedShowCreateBlueprintDialog}
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
                    value={displayedBlueprintTitle}
                    onChange={(e) => setBlueprintTitle(e.target.value)}
                    disabled={displayedBlueprintBusy || !formStateReady}
                    placeholder="Grade 11 Computer Science"
                  />
                </FormField>

                <div className="rounded-md border border-border bg-surface-2 px-4 py-3 text-sm text-text-muted">
                  The course blueprint will include teacher-authored course content only. Students, submissions, grades, attendance, join codes, and roster data are not included.
                </div>

                {displayedBlueprintError ? (
                  <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
                    {displayedBlueprintError}
                  </div>
                ) : null}
              </div>

              <div className="mt-6 flex gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={closeCreateBlueprintDialog}
                  className="flex-1"
                  disabled={displayedBlueprintBusy || !formStateReady}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={createBlueprintFromClassroom}
                  className="flex-1"
                  disabled={displayedBlueprintBusy || !displayedBlueprintTitle.trim() || !formStateReady}
                >
                  {displayedBlueprintBusy ? 'Saving...' : 'Save Blueprint'}
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
