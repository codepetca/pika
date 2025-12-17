'use client'

import { useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import type { Classroom } from '@/types'

interface Props {
  classroom: Classroom
}

export function TeacherSettingsTab({ classroom }: Props) {
  const joinLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${classroom.class_code}`
  const [allowEnrollment, setAllowEnrollment] = useState<boolean>(classroom.allow_enrollment)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore
    }
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

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Classroom configuration and invite info."
      />

      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-4">
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

        {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
        {success && <div className="text-sm text-green-700 dark:text-green-400">{success}</div>}
      </div>

      <div className="space-y-2">
        <div className="text-sm text-gray-600 dark:text-gray-400">Join code</div>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 text-sm text-gray-900 dark:text-gray-100">
            {classroom.class_code}
          </code>
          <button
            type="button"
            className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => copy(classroom.class_code)}
          >
            Copy
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-gray-600 dark:text-gray-400">Join link</div>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 text-sm text-gray-900 dark:text-gray-100 break-all">
            {joinLink}
          </code>
          <button
            type="button"
            className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => copy(joinLink)}
          >
            Copy
          </button>
        </div>
      </div>

      <div className="text-sm text-gray-600 dark:text-gray-400">
        Students must be on the roster (uploaded via CSV) and enrollment must be enabled to join.
      </div>
    </div>
  )
}
