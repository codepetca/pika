'use client'

import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { UploadRosterModal } from '@/components/UploadRosterModal'
import { AddStudentsModal } from '@/components/AddStudentsModal'
import { ACTIONBAR_BUTTON_CLASSNAME, ACTIONBAR_BUTTON_SECONDARY_CLASSNAME, PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  DataTableHeaderCell,
  EmptyStateRow,
  SortableHeaderCell,
  TableCard,
} from '@/components/DataTable'
import type { Classroom } from '@/types'
import { Check, Trash2 } from 'lucide-react'
import { applyDirection, compareNullableStrings, toggleSort } from '@/lib/table-sort'

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
  const isReadOnly = !!classroom.archived_at
  const [loading, setLoading] = useState(true)
  const [roster, setRoster] = useState<RosterRow[]>([])
  const [error, setError] = useState<string>('')
  const [isUploadModalOpen, setUploadModalOpen] = useState(false)
  const [isAddModalOpen, setAddModalOpen] = useState(false)
  const [{ column: sortColumn, direction: sortDirection }, setSortState] = useState<{
    column: 'first_name' | 'last_name'
    direction: 'asc' | 'desc'
  }>({ column: 'last_name', direction: 'asc' })
  const [pendingRemoval, setPendingRemoval] = useState<{
    rosterId: string
    email: string
    firstName: string | null
    lastName: string | null
    joined: boolean
  } | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)

  const sortedRoster = useMemo(() => {
    const rows = [...roster]
    rows.sort((a, b) => {
      const aValue = sortColumn === 'first_name' ? a.first_name : a.last_name
      const bValue = sortColumn === 'first_name' ? b.first_name : b.last_name
      const cmp = compareNullableStrings(aValue, bValue, { missingLast: true })
      if (cmp !== 0) return applyDirection(cmp, sortDirection)

      return applyDirection(a.email.localeCompare(b.email), sortDirection)
    })
    return rows
  }, [roster, sortColumn, sortDirection])

  function onSort(column: 'first_name' | 'last_name') {
    setSortState((prev) => toggleSort(prev, column))
  }

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

  async function confirmRemoveStudent() {
    if (!pendingRemoval) return
    if (isReadOnly) return
    setIsRemoving(true)
    setError('')

    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}/roster/${pendingRemoval.rosterId}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to remove student')
      }
      setPendingRemoval(null)
      await loadRoster()
    } catch (err: any) {
      setError(err.message || 'Failed to remove student')
    } finally {
      setIsRemoving(false)
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
    <PageLayout>
      <PageActionBar
        primary={
          <div className="flex gap-2">
            <button
              type="button"
              className={ACTIONBAR_BUTTON_CLASSNAME}
              onClick={() => setAddModalOpen(true)}
              disabled={isReadOnly}
            >
              Add Students
            </button>
            <button
              type="button"
              className={ACTIONBAR_BUTTON_SECONDARY_CLASSNAME}
              onClick={() => setUploadModalOpen(true)}
              disabled={isReadOnly}
            >
              Upload CSV
            </button>
          </div>
        }
        actions={[
          {
            id: 'refresh',
            label: 'Refresh',
            onSelect: loadRoster,
          },
        ]}
      />

      <PageContent>
        <TableCard>
          {error && (
            <div className="p-3 border-b border-gray-200 dark:border-gray-700">
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
                {error}
              </div>
            </div>
          )}

          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <SortableHeaderCell
                  label="First Name"
                  isActive={sortColumn === 'first_name'}
                  direction={sortDirection}
                  onClick={() => onSort('first_name')}
                />
                <SortableHeaderCell
                  label="Last Name"
                  isActive={sortColumn === 'last_name'}
                  direction={sortDirection}
                  onClick={() => onSort('last_name')}
                />
                <DataTableHeaderCell>Email</DataTableHeaderCell>
                <DataTableHeaderCell align="center">Joined</DataTableHeaderCell>
                <DataTableHeaderCell align="right">Actions</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {sortedRoster.map((row) => (
                <DataTableRow key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <DataTableCell>{row.first_name ?? '—'}</DataTableCell>
                  <DataTableCell>{row.last_name ?? '—'}</DataTableCell>
                  <DataTableCell className="text-gray-600 dark:text-gray-400">{row.email}</DataTableCell>
                  <DataTableCell align="center">
                    {row.joined && (
                      <Check className="mx-auto h-5 w-5 text-green-600 dark:text-green-400" aria-hidden="true" />
                    )}
                  </DataTableCell>
                  <DataTableCell align="right">
                    <button
                      type="button"
                      className={[
                        'text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200',
                        isReadOnly ? 'opacity-50 cursor-not-allowed' : '',
                      ].join(' ')}
                      onClick={() => {
                        if (isReadOnly) return
                        setPendingRemoval({
                          rosterId: row.id,
                          email: row.email,
                          firstName: row.first_name,
                          lastName: row.last_name,
                          joined: row.joined,
                        })
                      }}
                      aria-label={`Remove ${row.email}`}
                      disabled={isReadOnly}
                    >
                      <Trash2 className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </DataTableCell>
                </DataTableRow>
              ))}
              {sortedRoster.length === 0 && (
                <EmptyStateRow colSpan={5} message="No students on the roster" />
              )}
            </DataTableBody>
          </DataTable>
        </TableCard>
      </PageContent>

      <AddStudentsModal
        isOpen={isAddModalOpen}
        onClose={() => setAddModalOpen(false)}
        classroomId={classroom.id}
        onSuccess={loadRoster}
      />

      <UploadRosterModal
        isOpen={isUploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        classroomId={classroom.id}
        onSuccess={loadRoster}
      />

      <ConfirmDialog
        isOpen={!!pendingRemoval}
        title="Remove student?"
        description={
          pendingRemoval
            ? `${
                pendingRemoval.firstName || pendingRemoval.lastName
                  ? `${pendingRemoval.firstName ?? ''} ${pendingRemoval.lastName ?? ''}`.trim()
                  : 'Unnamed student'
              }\n${pendingRemoval.email}\n\n${
                pendingRemoval.joined
                  ? 'They are currently joined. This will delete their classroom data (logs and assignment docs).'
                  : 'They are not joined yet.'
              }`
            : undefined
        }
        confirmLabel={isRemoving ? 'Removing...' : 'Remove'}
        cancelLabel="Cancel"
        confirmVariant="danger"
        isCancelDisabled={isRemoving}
        isConfirmDisabled={isRemoving}
        onCancel={() => (isRemoving ? null : setPendingRemoval(null))}
        onConfirm={confirmRemoveStudent}
      />
    </PageLayout>
  )
}
