'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
  type ReactNode,
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
import { CLASSROOM_THEME_PALETTE, getClassroomThemeStyle, type ClassroomThemeColor } from '@/lib/classroom-theme'
import { invalidateTeacherClassrooms } from '@/lib/teacher-classrooms-client'
import {
  normalizeClassroomFeatureVisibility,
  type ClassroomFeatureKey,
  type ClassroomFeatureVisibility,
} from '@/lib/classroom-feature-visibility'
import { TeacherCalendarTab } from './TeacherCalendarTab'
import { SettingsSwitchRow } from '@/components/settings/SettingsSwitchRow'
import type { Classroom, ClassroomJoinPolicy, LessonPlanVisibility } from '@/types'

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function generateJoinCode() {
  return Array.from({ length: 6 })
    .map(() => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)])
    .join('')
}

type SettingsSection = 'general' | 'access' | 'features' | 'class-days' | 'reuse' | 'advanced'

const SETTINGS_SECTION_OPTIONS: Array<{ value: SettingsSection; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'access', label: 'Access' },
  { value: 'features', label: 'Features' },
  { value: 'class-days', label: 'Class Days' },
  { value: 'reuse', label: 'Reuse' },
  { value: 'advanced', label: 'Advanced' },
]

const SETTINGS_SECTIONS = new Set<SettingsSection>(SETTINGS_SECTION_OPTIONS.map((option) => option.value))

function parseSettingsSection(value: string | null | undefined): SettingsSection {
  return value && SETTINGS_SECTIONS.has(value as SettingsSection) ? (value as SettingsSection) : 'general'
}

const LESSON_PLAN_VISIBILITY_OPTIONS = [
  { value: 'current_week', label: 'Current week (and all previous)' },
  { value: 'one_week_ahead', label: '1 week ahead' },
  { value: 'all', label: 'All (no restrictions)' },
]

interface Props {
  classroom: Classroom
  palEnabled?: boolean
  sectionParam?: string | null
  onSectionChange?: (section: SettingsSection) => void
  onClassroomUpdated?: (classroom: Classroom) => void
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

export function TeacherSettingsTab({
  classroom,
  palEnabled = false,
  sectionParam,
  onSectionChange = () => {},
  onClassroomUpdated,
}: Props) {
  const router = useRouter()
  const section = parseSettingsSection(sectionParam)
  const titleId = useId()
  const isReadOnly = !!classroom.archived_at
  const sectionNavigationRef = useRef<HTMLDivElement>(null)
  const activeClassroomIdRef = useRef(classroom.id)
  const formClassroomIdRef = useRef(classroom.id)
  const formGenerationRef = useRef(0)
  const blueprintOperationRef = useRef<{ fingerprint: string; id: string } | null>(null)
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
  const [featureVisibility, setFeatureVisibility] = useState<ClassroomFeatureVisibility>(
    normalizeClassroomFeatureVisibility(classroom.feature_visibility),
  )
  const [featureVisibilitySaving, setFeatureVisibilitySaving] = useState(false)
  const [featureVisibilityError, setFeatureVisibilityError] = useState('')
  const [themeColor, setThemeColor] = useState<ClassroomThemeColor>(classroom.theme_color)
  const [themeSaving, setThemeSaving] = useState(false)
  const [themeError, setThemeError] = useState('')
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
  const displayedFeatureVisibility = formStateReady
    ? featureVisibility
    : normalizeClassroomFeatureVisibility(classroom.feature_visibility)
  const displayedFeatureVisibilitySaving = formStateReady && featureVisibilitySaving
  const displayedFeatureVisibilityError = formStateReady ? featureVisibilityError : ''
  const displayedThemeColor = formStateReady ? themeColor : classroom.theme_color
  const displayedThemeSaving = formStateReady && themeSaving
  const displayedThemeError = formStateReady ? themeError : ''
  const displayedShowCreateBlueprintDialog = formStateReady && showCreateBlueprintDialog
  const displayedBlueprintTitle = formStateReady ? blueprintTitle : classroom.title
  const displayedBlueprintBusy = formStateReady && blueprintBusy
  const displayedBlueprintError = formStateReady ? blueprintError : ''
  const joinLink = `${origin}/join/${displayedJoinCode}`

  useEffect(() => {
    const activeSection = sectionNavigationRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    activeSection?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [section])

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
    setFeatureVisibility(normalizeClassroomFeatureVisibility(classroom.feature_visibility))
    setFeatureVisibilitySaving(false)
    setFeatureVisibilityError('')
    setThemeColor(classroom.theme_color)
    setThemeSaving(false)
    setThemeError('')
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
      if (data.classroom) {
        onClassroomUpdated?.(data.classroom)
      }
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
      if (data.classroom) {
        onClassroomUpdated?.(data.classroom)
      }
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
      if (data.classroom) {
        onClassroomUpdated?.(data.classroom)
      }
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
      if (data.classroom) {
        onClassroomUpdated?.(data.classroom)
      }
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
      if (data.classroom) {
        onClassroomUpdated?.(data.classroom)
      }
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

  async function saveThemeColor(value: ClassroomThemeColor) {
    if (isReadOnly || value === themeColor) return
    const classroomId = classroom.id
    if (!hasCurrentFormState(classroomId)) return
    const formGeneration = formGenerationRef.current
    setThemeSaving(true)
    setThemeError('')
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themeColor: value }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update classroom color')
      }
      invalidateTeacherClassrooms()
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      if (data.classroom) {
        onClassroomUpdated?.(data.classroom)
      }
      setThemeColor(data.classroom?.theme_color || value)
      showMessage({ text: 'Classroom color updated', tone: 'success' })
    } catch (err: any) {
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      setThemeError(err.message || 'Failed to update classroom color')
    } finally {
      if (isCurrentFormGeneration(classroomId, formGeneration)) {
        setThemeSaving(false)
      }
    }
  }

  async function saveFeatureVisibility(feature: ClassroomFeatureKey, enabled: boolean) {
    if (isReadOnly) return
    const classroomId = classroom.id
    if (!hasCurrentFormState(classroomId) || featureVisibilitySaving) return
    const formGeneration = formGenerationRef.current
    const previousVisibility = featureVisibility
    const nextVisibility = { ...featureVisibility, [feature]: enabled }

    setFeatureVisibility(nextVisibility)
    setFeatureVisibilitySaving(true)
    setFeatureVisibilityError('')
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureVisibility: nextVisibility }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update classroom features')
      }
      invalidateTeacherClassrooms()
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      const savedVisibility = normalizeClassroomFeatureVisibility(
        data.classroom?.feature_visibility ?? nextVisibility,
      )
      setFeatureVisibility(savedVisibility)
      if (data.classroom) {
        onClassroomUpdated?.({ ...data.classroom, feature_visibility: savedVisibility })
      }
      showMessage({ text: 'Classroom features updated', tone: 'success' })
    } catch (err: any) {
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      setFeatureVisibility(previousVisibility)
      setFeatureVisibilityError(err.message || 'Failed to update classroom features')
    } finally {
      if (isCurrentFormGeneration(classroomId, formGeneration)) {
        setFeatureVisibilitySaving(false)
      }
    }
  }

  function openCreateBlueprintDialog() {
    setBlueprintTitle(classroom.title)
    setBlueprintError('')
    blueprintOperationRef.current = null
    setShowCreateBlueprintDialog(true)
  }

  function closeCreateBlueprintDialog() {
    if (blueprintBusy) return
    setBlueprintError('')
    blueprintOperationRef.current = null
    setShowCreateBlueprintDialog(false)
  }

  async function createBlueprintFromClassroom() {
    if (isReadOnly) return
    const classroomId = classroom.id
    if (!hasCurrentFormState(classroomId)) return
    const formGeneration = formGenerationRef.current
    const blueprintTitleValue = blueprintTitle.trim() || classroom.title
    const fingerprint = JSON.stringify({ classroomId, title: blueprintTitleValue })
    if (blueprintOperationRef.current?.fingerprint !== fingerprint) {
      blueprintOperationRef.current = { fingerprint, id: crypto.randomUUID() }
    }
    setBlueprintBusy(true)
    setBlueprintError('')
    try {
      const response = await fetch(`/api/teacher/classrooms/${classroomId}/blueprint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': blueprintOperationRef.current.id,
        },
        body: JSON.stringify({ title: blueprintTitleValue }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save classroom as a course blueprint')
      }
      if (!isCurrentFormGeneration(classroomId, formGeneration)) return
      blueprintOperationRef.current = null
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
      <div ref={sectionNavigationRef} className="mb-2 overflow-x-auto pb-1">
        <SegmentedControl
          ariaLabel="Settings section"
          value={section}
          options={SETTINGS_SECTION_OPTIONS}
          onChange={onSectionChange}
          className="[&_button]:min-h-11"
        />
      </div>

      {section !== 'class-days' ? (
        <PageContent className="space-y-4 pt-0">
          {section === 'general' ? (
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
          ) : null}

          {section === 'access' ? (
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
          ) : null}

          {section === 'features' ? (
            <SettingsPanel>
              <SettingsHeading
                title="Classroom features"
                tooltip="Choose which optional areas appear in this classroom."
              />

              <div className="rounded-control border border-border bg-surface-2 px-3 py-2 text-sm text-text-muted">
                Daily, Roster, and Settings are always available. Hiding a feature does not delete its content.
              </div>

              <div className="divide-y divide-border">
                {(
                  [
                    ['attendance', 'Attendance', 'Teacher only · Live attendance check-in'],
                    ['classwork', 'Classwork', 'Teacher and students · Assignments, materials, and surveys'],
                    ['tests', 'Tests', 'Teacher and students · Assessments and responses'],
                    ['gradebook', 'Gradebook', 'Teacher only · Requires Classwork or Tests'],
                    ['calendar', 'Calendar', 'Teacher and students · Lesson plans'],
                    ['syllabus', 'Course Guide', 'Teacher and students · Course information and resources'],
                    ['announcements', 'Announcements', 'Teacher and students · Classroom updates'],
                    ...(palEnabled
                      ? [['achievements', 'Achievements', 'Students only · Pal achievements and progress']]
                      : []),
                  ] as Array<[ClassroomFeatureKey, string, string]>
                ).map(([feature, label, description]) => {
                  const gradebookUnavailable =
                    feature === 'gradebook' &&
                    !displayedFeatureVisibility.classwork &&
                    !displayedFeatureVisibility.tests
                  const visibleChecked = gradebookUnavailable
                    ? false
                    : displayedFeatureVisibility[feature]
                  const visibleDescription = gradebookUnavailable
                    ? 'Teacher only · Hidden until Classwork or Tests is enabled'
                    : description
                  return (
                    <SettingsSwitchRow
                      key={feature}
                      checked={visibleChecked}
                      onChange={(enabled) => saveFeatureVisibility(feature, enabled)}
                      disabled={
                        displayedFeatureVisibilitySaving ||
                        isReadOnly ||
                        !formStateReady ||
                        gradebookUnavailable
                      }
                      ariaLabel={`Show ${label}`}
                      className="py-3"
                    >
                      <span className="block font-medium">{label}</span>
                      <span className="block text-xs text-text-muted">{visibleDescription}</span>
                    </SettingsSwitchRow>
                  )
                })}
              </div>

              {displayedFeatureVisibilitySaving ? (
                <div className="text-sm text-text-muted">Saving...</div>
              ) : null}
              {displayedFeatureVisibilityError ? (
                <div className="text-sm text-danger">{displayedFeatureVisibilityError}</div>
              ) : null}
            </SettingsPanel>
          ) : null}

          {section === 'access' ? (
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
          ) : null}

          {section === 'general' ? (
            <SettingsPanel>
            <div className="text-sm font-semibold text-text-default">Display</div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-text-default">Classroom color</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="group" aria-label="Classroom color">
                {CLASSROOM_THEME_PALETTE.map((option) => {
                  const selected = displayedThemeColor === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => saveThemeColor(option.value)}
                      disabled={displayedThemeSaving || isReadOnly || !formStateReady}
                      aria-pressed={selected}
                      style={getClassroomThemeStyle(option.value)}
                      className={cn(
                        'classroom-theme classroom-theme-option flex min-h-11 items-center justify-between gap-3 rounded-control border px-3 py-2 text-left text-sm text-text-default transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-page',
                        selected
                          ? 'classroom-theme-option-selected border-l-4'
                          : 'border-border hover:border-border-strong',
                        (displayedThemeSaving || isReadOnly || !formStateReady) && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <span className="min-w-0 truncate">{option.label}</span>
                      {selected ? (
                        <span className="shrink-0 text-xs font-semibold text-primary">Selected</span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
              {displayedThemeSaving && <span className="text-sm text-text-muted">Saving...</span>}
              {displayedThemeError && <div className="text-sm text-danger">{displayedThemeError}</div>}
            </div>
            </SettingsPanel>
          ) : null}

          {section === 'reuse' ? (
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
          ) : null}

          {section === 'advanced' ? (
            <SettingsPanel>
              <SettingsHeading title="Markdown" />
              <SettingsSwitchRow
                checked={markdownMounted ? showMarkdown : true}
                onChange={setShowMarkdown}
                ariaLabel="Show markdown"
              >
                <span className="font-medium">Show markdown</span>
              </SettingsSwitchRow>
            </SettingsPanel>
          ) : null}

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
