'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import type { Classroom } from '@/types'

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function generateJoinCode() {
  return Array.from({ length: 6 })
    .map(() => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)])
    .join('')
}

interface Props {
  classroom: Classroom
}

export function TeacherSettingsTab({ classroom }: Props) {
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

  return (
    <PageLayout>
      <PageActionBar
        primary={
          <label className="inline-flex items-center gap-3 text-sm">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Allow enrollment
            </span>
            <input
              type="checkbox"
              checked={allowEnrollment}
              onChange={(e) => saveAllowEnrollment(e.target.checked)}
              disabled={saving || isReadOnly}
              className="h-4 w-4"
            />
            <span className="text-gray-700 dark:text-gray-300">
              {allowEnrollment ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        }
      />

      <PageContent className="space-y-5">
        {(enrollmentError || enrollmentSuccess) && (
          <div className="space-y-2">
            {enrollmentError && <div className="text-sm text-red-600 dark:text-red-400">{enrollmentError}</div>}
            {enrollmentSuccess && <div className="text-sm text-green-700 dark:text-green-400">{enrollmentSuccess}</div>}
          </div>
        )}

        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Join Code</div>
        <div className="text-xs text-gray-600 dark:text-gray-400">
          Students must be on the roster to join.
        </div>

        <div className="flex flex-col sm:flex-row sm:items-stretch gap-3">
          <button
            type="button"
            className="w-full sm:w-auto rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-left font-mono text-base font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800"
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
            className="w-full flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-left font-mono text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 truncate"
            onClick={() => copyWithNotice('Join link', joinLink)}
            aria-label="Copy join link"
            title={joinLink}
          >
            {joinLink}
          </button>
        </div>

        {joinCodeError && <div className="text-sm text-red-600 dark:text-red-400">{joinCodeError}</div>}
        {joinCodeSuccess && <div className="text-sm text-green-700 dark:text-green-400">{joinCodeSuccess}</div>}
        {copyNotice && <div className="text-xs text-blue-600 dark:text-blue-300">{copyNotice}</div>}
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
    </PageLayout>
  )
}
