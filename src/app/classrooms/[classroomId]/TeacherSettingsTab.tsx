'use client'

import Link from 'next/link'
import { useMemo, useState, useId } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button, ConfirmDialog } from '@/ui'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import { TeacherCalendarTab } from './TeacherCalendarTab'
import type { Classroom, LessonPlanVisibility } from '@/types'

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function generateJoinCode() {
  return Array.from({ length: 6 })
    .map(() => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)])
    .join('')
}

type SettingsSection = 'general' | 'class-days'

interface Props {
  classroom: Classroom
}

export function TeacherSettingsTab({ classroom }: Props) {
  const searchParams = useSearchParams()
  const sectionParam = searchParams.get('section')
  const section: SettingsSection = sectionParam === 'class-days' ? 'class-days' : 'general'
  const allowEnrollmentId = useId()
  const isReadOnly = !!classroom.archived_at
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

  return (
    <PageLayout>
      {/* Sub-tab navigation */}
      <div className="flex border-b border-border mb-4">
        <Link
          href={`/classrooms/${classroom.id}?tab=settings&section=general`}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            section === 'general'
              ? 'border-blue-500 text-primary'
              : 'border-transparent text-text-muted hover:text-text-default hover:border-border'
          }`}
        >
          General
        </Link>
        <Link
          href={`/classrooms/${classroom.id}?tab=settings&section=class-days`}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            section === 'class-days'
              ? 'border-blue-500 text-primary'
              : 'border-transparent text-text-muted hover:text-text-default hover:border-border'
          }`}
        >
          Class Days
        </Link>
      </div>

      {section === 'general' ? (
        <>
          <PageActionBar
            primary={
              <div className="inline-flex items-center gap-3 text-sm">
                <label htmlFor={allowEnrollmentId} className="text-sm font-medium text-text-default">
                  Allow enrollment
                </label>
                <input
                  id={allowEnrollmentId}
                  type="checkbox"
                  checked={allowEnrollment}
                  onChange={(e) => saveAllowEnrollment(e.target.checked)}
                  disabled={saving || isReadOnly}
                  className="h-4 w-4"
                />
                <span className="text-text-muted">
                  {allowEnrollment ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            }
          />

          <PageContent className="space-y-5">
            {(enrollmentError || enrollmentSuccess) && (
              <div className="space-y-2">
                {enrollmentError && <div className="text-sm text-danger">{enrollmentError}</div>}
                {enrollmentSuccess && <div className="text-sm text-success">{enrollmentSuccess}</div>}
              </div>
            )}

            <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
              <div className="text-sm font-semibold text-text-default">Join Code</div>
              <div className="text-xs text-text-muted">
                Students must be on the roster to join.
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

              {joinCodeError && <div className="text-sm text-danger">{joinCodeError}</div>}
              {joinCodeSuccess && <div className="text-sm text-success">{joinCodeSuccess}</div>}
              {copyNotice && <div className="text-xs text-info">{copyNotice}</div>}
            </div>

            <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
              <div className="text-sm font-semibold text-text-default">Calendar Visibility</div>
              <div className="text-xs text-text-muted">
                Control how far ahead students can see lesson plans on the Calendar tab.
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
          </PageContent>
        </>
      ) : (
        <PageContent>
          <TeacherCalendarTab classroom={classroom} />
        </PageContent>
      )}
    </PageLayout>
  )
}
