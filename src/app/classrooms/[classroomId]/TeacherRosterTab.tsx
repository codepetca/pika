'use client'

import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import type { Classroom } from '@/types'

interface RosterRow {
  student_id: string
  email: string
  first_name: string | null
  last_name: string | null
  student_number: string | null
  created_at: string
}

interface Props {
  classroom: Classroom
}

function normalizeRosterRows(raw: any[]): RosterRow[] {
  return (raw || []).map((row) => {
    const profile = row.student_profiles || {}
    const user = row.users || {}
    return {
      student_id: row.student_id,
      email: user.email,
      first_name: profile.first_name ?? null,
      last_name: profile.last_name ?? null,
      student_number: profile.student_number ?? null,
      created_at: row.created_at,
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
      setSuccess(`Uploaded. Added ${data.addedCount ?? 0} students.`)
      await loadRoster()
    } catch (err: any) {
      setError(err.message || 'Failed to upload CSV')
    } finally {
      setUploading(false)
    }
  }

  async function removeStudent(studentId: string, email: string) {
    setError('')
    setSuccess('')
    const ok = window.confirm(
      `Remove ${email} from this classroom?\n\nThis will delete their classroom data (logs and assignment docs).`
    )
    if (!ok) return

    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}/roster/${studentId}`, {
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
          <div key={row.student_id} className="p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900">{row.email}</div>
              <div className="mt-1 text-sm text-gray-600">
                {row.first_name || row.last_name
                  ? `${row.last_name ?? ''}${row.last_name ? ', ' : ''}${row.first_name ?? ''}`.trim()
                  : '(no name)'}
                {row.student_number ? ` • ${row.student_number}` : ''}
              </div>
            </div>
            <button
              type="button"
              className="px-3 py-2 rounded-md border border-red-200 bg-white text-sm text-red-700 hover:bg-red-50 flex-shrink-0"
              onClick={() => removeStudent(row.student_id, row.email)}
            >
              Remove
            </button>
          </div>
        ))}

        {sortedRoster.length === 0 && (
          <div className="p-6 text-center text-gray-500">No students enrolled</div>
        )}
      </div>
    </div>
  )
}

