'use client'

import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import type { Classroom } from '@/types'

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
  const [success, setSuccess] = useState<string>('')

  const [uploading, setUploading] = useState(false)
  const [csvText, setCsvText] = useState('')

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
          // This can happen if you logged in as a student in another tab and replaced the teacher session cookie.
          try {
            const meRes = await fetch('/api/auth/me')
            const meData = await meRes.json().catch(() => ({}))
            const role = (meData?.user?.role ?? null) as Role | null
            if (role && role !== 'teacher') {
              throw new Error('You are not signed in as a teacher. Log out and sign back in as a teacher (student sign-in in another tab replaces the session).')
            }
          } catch {
            // Ignore and fall back to generic message below.
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

  async function onPickFile(file: File | null) {
    if (!file) return
    setError('')
    setSuccess('')
    try {
      const text = await file.text()
      setCsvText(text)
    } catch {
      setError('Failed to read file')
    }
  }

  async function uploadCsv() {
    setUploading(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}/roster/upload-csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvData: csvText }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to upload CSV')
      }
      setSuccess(`Uploaded. Upserted ${data.upsertedCount ?? 0} roster rows.`)
      await loadRoster()
    } catch (err: any) {
      setError(err.message || 'Failed to upload CSV')
    } finally {
      setUploading(false)
    }
  }

  async function removeStudent(rosterId: string, email: string, joined: boolean) {
    setError('')
    setSuccess('')
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
      setSuccess(`Removed ${email}.`)
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
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Roster</h2>
          <button
            type="button"
            className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm hover:bg-gray-50"
            onClick={loadRoster}
          >
            Refresh
          </button>
        </div>

        <div className="text-sm text-gray-600">
          Upload CSV with columns: Student Number, First Name, Last Name, Email
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            className="text-sm"
            disabled={uploading}
          />
          <button
            type="button"
            className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
            onClick={uploadCsv}
            disabled={uploading || csvText.trim().length === 0}
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}
        {success && <div className="text-sm text-green-700">{success}</div>}
      </div>

      <div className="bg-white rounded-lg shadow-sm divide-y divide-gray-100">
        {sortedRoster.map((row) => (
          <div key={row.id} className="p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900">{row.email}</div>
              <div className="mt-1 text-sm text-gray-600">
                {row.first_name || row.last_name
                  ? `${row.last_name ?? ''}${row.last_name ? ', ' : ''}${row.first_name ?? ''}`.trim()
                  : '(no name)'}
                {row.student_number ? ` • ${row.student_number}` : ''}
                <span className="ml-2">
                  {row.joined ? (
                    <span className="text-green-700">Joined</span>
                  ) : (
                    <span className="text-gray-500">Not joined</span>
                  )}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="px-3 py-2 rounded-md border border-red-200 bg-white text-sm text-red-700 hover:bg-red-50 flex-shrink-0"
              onClick={() => removeStudent(row.id, row.email, row.joined)}
            >
              Remove
            </button>
          </div>
        ))}

        {sortedRoster.length === 0 && (
          <div className="p-6 text-center text-gray-500">No students on the roster</div>
        )}
      </div>
    </div>
  )
}
