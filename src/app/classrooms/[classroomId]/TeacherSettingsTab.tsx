'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
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
  const [joinCode, setJoinCode] = useState(classroom.class_code)
  const [allowEnrollment, setAllowEnrollment] = useState<boolean>(classroom.allow_enrollment)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')
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
    setSaving(true)
    setError('')
    setSuccess('')
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
      setSuccess('Settings saved.')
    } catch (err: any) {
      setError(err.message || 'Failed to update settings')
    } finally {
      setSaving(false)
    }
  }

  async function regenerateJoinCode() {
    setIsRegenerating(true)
    setError('')
    setSuccess('')
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
      setSuccess('Join code regenerated.')
    } catch (err: any) {
      setError(err.message || 'Failed to regenerate join code')
    } finally {
      setIsRegenerating(false)
      setShowRegenerateConfirm(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Allow enrollment</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              When disabled, students cannot join using the code/link.
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowEnrollment}
              onChange={(e) => saveAllowEnrollment(e.target.checked)}
              disabled={saving}
              className="h-4 w-4"
            />
            <span className="text-gray-700 dark:text-gray-300">{allowEnrollment ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>

        {error && <div className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
        {success && <div className="mt-3 text-sm text-green-700 dark:text-green-400">{success}</div>}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Invitation</div>
        <div className="text-xs text-gray-600 dark:text-gray-400">
          Students must be on the roster to join.
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
          <button
            type="button"
            className="flex-1 text-left text-lg font-semibold text-gray-900 dark:text-gray-100"
            onClick={() => copyWithNotice('Join code', joinCode)}
          >
            <span className="select-all">{joinCode}</span>
          </button>
          <Button
            variant="secondary"
            onClick={() => setShowRegenerateConfirm(true)}
            disabled={isRegenerating}
          >
            {isRegenerating ? 'Regenerating…' : 'Regenerate code'}
          </Button>
        </div>
        <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
          <button
            type="button"
            className="text-sm text-gray-700 dark:text-gray-200 break-words text-left"
            onClick={() => copyWithNotice('Join link', joinLink)}
          >
            {joinLink}
          </button>
        </div>
        {copyNotice && <div className="text-xs text-blue-600 dark:text-blue-300">{copyNotice}</div>}
      </div>

      <ConfirmDialog
        isOpen={showRegenerateConfirm}
        title="Regenerate join code?"
        description="This replaces the current code. Students will need the new link to join."
        confirmLabel={isRegenerating ? 'Regenerating…' : 'Regenerate'}
        cancelLabel="Cancel"
        confirmVariant="danger"
        isConfirmDisabled={isRegenerating}
        isCancelDisabled={isRegenerating}
        onCancel={() => (isRegenerating ? null : setShowRegenerateConfirm(false))}
        onConfirm={regenerateJoinCode}
      />
    </div>
  )
}
