'use client'

import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/Button'
import { UploadRosterModal } from '@/components/UploadRosterModal'
import type { Classroom } from '@/types'
import { CheckIcon, TrashIcon } from '@heroicons/react/24/outline'

type Role = 'student' | 'teacher'

interface RosterRow {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  student_number: string | null
  created_at: string
  updated_at: string
  joined: boolean
  student_id: string | null
  joined_at: string | null
}

interface Props {
  classroom: Classroom
}

function normalizeRosterRows(raw: any[]): RosterRow[] {
  return (raw || []).map((row) => {
    return {
      id: row.id,
      email: row.email,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      student_number: row.student_number ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      joined: !!row.joined,
      student_id: row.student_id ?? null,
      joined_at: row.joined_at ?? null,
    } satisfies RosterRow
  })
}

export function TeacherRosterTab({ classroom }: Props) {
  const [loading, setLoading] = useState(true)
  const [roster, setRoster] = useState<RosterRow[]>([])
  const [error, setError] = useState<string>('')
  const [isUploadModalOpen, setUploadModalOpen] = useState(false)

  const sortedRoster = useMemo(() => {
    return [...roster].sort((a, b) => a.email.localeCompare(b.email))
  }, [roster])

  async function loadRoster() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}/roster`)
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          try {
            const meRes = await fetch('/api/auth/me')
            const meData = await meRes.json().catch(() => ({}))
            const role = (meData?.user?.role ?? null) as Role | null
            if (role && role !== 'teacher') {
              throw new Error('You are not signed in as a teacher. Log out and sign back in as a teacher (student sign-in in another tab replaces the session).')
            }
          } catch {
            // Fallback to generic message below
          }
        }
        throw new Error(data.error || 'Failed to load roster')
      }
      setRoster(normalizeRosterRows(data.roster || []))
    } catch (err: any) {
      setError(err.message || 'Failed to load roster')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRoster()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroom.id])

  async function removeStudent(rosterId: string, email: string, joined: boolean) {
    setError('')
    const ok = window.confirm(
      joined
        ? `Remove ${email} from this classroom?\n\nThey are currently joined. This will delete their classroom data (logs and assignment docs).`
        : `Remove ${email} from this classroom roster?\n\nThey are not joined yet.`
    )
    if (!ok) return

    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}/roster/${rosterId}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to remove student')
      }
      await loadRoster()
    } catch (err: any) {
      setError(err.message || 'Failed to remove student')
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button onClick={() => setUploadModalOpen(true)}>Upload CSV</Button>
        <Button variant="secondary" onClick={loadRoster}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                First Name
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                Last Name
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                Email
              </th>
              <th className="px-4 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-300">
                Joined
              </th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-700 dark:text-gray-300">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {sortedRoster.map((row) => (
              <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                  {row.first_name ?? '—'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                  {row.last_name ?? '—'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                  {row.email}
                </td>
                <td className="px-4 py-3 text-center">
                  {row.joined && (
                    <CheckIcon className="mx-auto h-5 w-5 text-green-600 dark:text-green-400" aria-hidden="true" />
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
                    onClick={() => removeStudent(row.id, row.email, row.joined)}
                    aria-label={`Remove ${row.email}`}
                  >
                    <TrashIcon className="h-5 w-5" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
            {sortedRoster.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  No students on the roster
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <UploadRosterModal
        isOpen={isUploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        classroomId={classroom.id}
        onSuccess={loadRoster}
      />
    </div>
  )
}
