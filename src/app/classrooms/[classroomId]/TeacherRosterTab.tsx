'use client'

import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { ConfirmDialog } from '@/ui'
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
import { Check, ChevronRight, Copy, Mail, Pencil, Trash2, X } from 'lucide-react'
import { applyDirection, compareNullableStrings, toggleSort } from '@/lib/table-sort'
import { useStudentSelection } from '@/hooks/useStudentSelection'

type Role = 'student' | 'teacher'

interface RosterRow {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  student_number: string | null
  counselor_email: string | null
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
      counselor_email: row.counselor_email ?? null,
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

  // Selection state
  const [isEmailMenuOpen, setEmailMenuOpen] = useState(false)
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null)

  // Counselor email editing state
  const [editingCounselorId, setEditingCounselorId] = useState<string | null>(null)
  const [editingCounselorValue, setEditingCounselorValue] = useState('')
  const [isSavingCounselor, setIsSavingCounselor] = useState(false)

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

  const rosterIds = useMemo(() => sortedRoster.map((r) => r.id), [sortedRoster])
  const { selectedIds, toggleSelect, toggleSelectAll, allSelected, clearSelection } = useStudentSelection(rosterIds)

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
      clearSelection()
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

  const someSelected = selectedIds.size > 0

  // Get emails for selected students
  const selectedRows = sortedRoster.filter((r) => selectedIds.has(r.id))
  const selectedStudentEmails = selectedRows.map((r) => r.email)
  const selectedCounselorEmails = selectedRows.map((r) => r.counselor_email).filter(Boolean) as string[]

  async function copyToClipboard(emails: string[], label: string) {
    const text = emails.join(', ')
    try {
      await navigator.clipboard.writeText(text)
      setCopiedMessage(`${label} copied!`)
      setTimeout(() => setCopiedMessage(null), 2000)
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopiedMessage(`${label} copied!`)
      setTimeout(() => setCopiedMessage(null), 2000)
    }
    setEmailMenuOpen(false)
  }

  function openGmail(emails: string[]) {
    const validEmails = emails.filter((e) => e && e.includes('@'))
    if (validEmails.length === 0) return
    const bcc = validEmails.join(',')
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&bcc=${encodeURIComponent(bcc)}`, '_blank')
    setEmailMenuOpen(false)
  }

  function openOutlook(emails: string[]) {
    const validEmails = emails.filter((e) => e && e.includes('@'))
    if (validEmails.length === 0) return
    const bcc = validEmails.join(',')
    window.open(`https://outlook.office.com/mail/deeplink/compose?bcc=${encodeURIComponent(bcc)}`, '_blank')
    setEmailMenuOpen(false)
  }

  // Counselor email editing
  function startEditingCounselor(row: RosterRow) {
    if (isReadOnly) return
    setEditingCounselorId(row.id)
    setEditingCounselorValue(row.counselor_email || '')
  }

  function cancelEditingCounselor() {
    setEditingCounselorId(null)
    setEditingCounselorValue('')
  }

  async function saveCounselorEmail(rosterId: string) {
    if (isReadOnly) return
    setIsSavingCounselor(true)
    setError('')

    try {
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}/roster/${rosterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counselor_email: editingCounselorValue.trim() || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update counselor email')
      }
      // Update local state
      setRoster((prev) =>
        prev.map((r) =>
          r.id === rosterId ? { ...r, counselor_email: editingCounselorValue.trim() || null } : r
        )
      )
      setEditingCounselorId(null)
      setEditingCounselorValue('')
    } catch (err: any) {
      setError(err.message || 'Failed to update counselor email')
    } finally {
      setIsSavingCounselor(false)
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
          <div className="flex gap-2 flex-wrap">
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
            {someSelected && (
              <div className="relative" onMouseLeave={() => setEmailMenuOpen(false)}>
                <button
                  type="button"
                  className={`${ACTIONBAR_BUTTON_SECONDARY_CLASSNAME} flex items-center gap-1`}
                  onClick={() => setEmailMenuOpen(!isEmailMenuOpen)}
                >
                  <Mail className="h-4 w-4" />
                  Email ({selectedIds.size})
                </button>
                {isEmailMenuOpen && (
                  <div className="absolute left-0 top-full pt-1 w-48 z-10">
                    <div className="rounded-md border border-border bg-surface shadow-lg">
                    {/* Students option with submenu */}
                    <div className="group relative">
                      <button
                        type="button"
                        className="w-full px-4 py-2 text-left text-sm hover:bg-surface-hover text-text-default flex items-center justify-between"
                      >
                        <span>Students ({selectedStudentEmails.length})</span>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      <div className="absolute left-full top-0 w-36 rounded-md border border-border bg-surface shadow-lg hidden group-hover:block">
                        <button
                          type="button"
                          className="w-full px-4 py-2 text-left text-sm hover:bg-surface-hover text-text-default flex items-center gap-2"
                          onClick={() => copyToClipboard(selectedStudentEmails, 'Student emails')}
                        >
                          <Copy className="h-4 w-4" />
                          Copy
                        </button>
                        <button
                          type="button"
                          className="w-full px-4 py-2 text-left text-sm hover:bg-surface-hover text-text-default"
                          onClick={() => openGmail(selectedStudentEmails)}
                        >
                          Gmail
                        </button>
                        <button
                          type="button"
                          className="w-full px-4 py-2 text-left text-sm hover:bg-surface-hover text-text-default"
                          onClick={() => openOutlook(selectedStudentEmails)}
                        >
                          Outlook
                        </button>
                      </div>
                    </div>

                    {/* Counselors option with submenu (only if there are counselor emails) */}
                    {selectedCounselorEmails.length > 0 && (
                      <div className="group relative">
                        <button
                          type="button"
                          className="w-full px-4 py-2 text-left text-sm hover:bg-surface-hover text-text-default flex items-center justify-between"
                        >
                          <span>Counselors ({selectedCounselorEmails.length})</span>
                          <ChevronRight className="h-4 w-4" />
                        </button>
                        <div className="absolute left-full top-0 w-36 rounded-md border border-border bg-surface shadow-lg hidden group-hover:block">
                          <button
                            type="button"
                            className="w-full px-4 py-2 text-left text-sm hover:bg-surface-hover text-text-default flex items-center gap-2"
                            onClick={() => copyToClipboard(selectedCounselorEmails, 'Counselor emails')}
                          >
                            <Copy className="h-4 w-4" />
                            Copy
                          </button>
                          <button
                            type="button"
                            className="w-full px-4 py-2 text-left text-sm hover:bg-surface-hover text-text-default"
                            onClick={() => openGmail(selectedCounselorEmails)}
                          >
                            Gmail
                          </button>
                          <button
                            type="button"
                            className="w-full px-4 py-2 text-left text-sm hover:bg-surface-hover text-text-default"
                            onClick={() => openOutlook(selectedCounselorEmails)}
                          >
                            Outlook
                          </button>
                        </div>
                      </div>
                    )}

                    {/* All option with submenu */}
                    <div className="group relative border-t border-border">
                      <button
                        type="button"
                        className="w-full px-4 py-2 text-left text-sm hover:bg-surface-hover text-text-default flex items-center justify-between"
                      >
                        <span>All ({selectedStudentEmails.length + selectedCounselorEmails.length})</span>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      <div className="absolute left-full top-0 w-36 rounded-md border border-border bg-surface shadow-lg hidden group-hover:block">
                        <button
                          type="button"
                          className="w-full px-4 py-2 text-left text-sm hover:bg-surface-hover text-text-default flex items-center gap-2"
                          onClick={() => copyToClipboard([...selectedStudentEmails, ...selectedCounselorEmails], 'All emails')}
                        >
                          <Copy className="h-4 w-4" />
                          Copy
                        </button>
                        <button
                          type="button"
                          className="w-full px-4 py-2 text-left text-sm hover:bg-surface-hover text-text-default"
                          onClick={() => openGmail([...selectedStudentEmails, ...selectedCounselorEmails])}
                        >
                          Gmail
                        </button>
                        <button
                          type="button"
                          className="w-full px-4 py-2 text-left text-sm hover:bg-surface-hover text-text-default"
                          onClick={() => openOutlook([...selectedStudentEmails, ...selectedCounselorEmails])}
                        >
                          Outlook
                        </button>
                      </div>
                    </div>
                    </div>
                  </div>
                )}
                {copiedMessage && (
                  <div className="absolute left-0 top-full mt-1 px-3 py-2 rounded-md bg-success-bg text-success text-sm z-20">
                    {copiedMessage}
                  </div>
                )}
              </div>
            )}
          </div>
        }
      />

      <PageContent>
        <TableCard>
          {error && (
            <div className="p-3 border-b border-border">
              <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
                {error}
              </div>
            </div>
          )}

          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell className="w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    aria-label="Select all students"
                  />
                </DataTableHeaderCell>
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
                <DataTableHeaderCell>Email ({sortedRoster.length} {sortedRoster.length === 1 ? 'student' : 'students'})</DataTableHeaderCell>
                <DataTableHeaderCell>Counselor</DataTableHeaderCell>
                <DataTableHeaderCell align="center">Joined</DataTableHeaderCell>
                <DataTableHeaderCell align="right">Actions</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {sortedRoster.map((row) => (
                <DataTableRow key={row.id} className="hover:bg-surface-hover">
                  <DataTableCell>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      onChange={() => toggleSelect(row.id)}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      aria-label={`Select ${row.first_name ?? ''} ${row.last_name ?? ''}`}
                    />
                  </DataTableCell>
                  <DataTableCell>{row.first_name ?? '—'}</DataTableCell>
                  <DataTableCell>{row.last_name ?? '—'}</DataTableCell>
                  <DataTableCell className="text-text-muted">{row.email}</DataTableCell>
                  <DataTableCell className="text-text-muted">
                    {editingCounselorId === row.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="email"
                          value={editingCounselorValue}
                          onChange={(e) => setEditingCounselorValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveCounselorEmail(row.id)
                            if (e.key === 'Escape') cancelEditingCounselor()
                          }}
                          className="w-32 rounded border border-border bg-surface px-2 py-1 text-sm text-text-default"
                          placeholder="counselor@..."
                          autoFocus
                          disabled={isSavingCounselor}
                        />
                        <button
                          type="button"
                          onClick={() => saveCounselorEmail(row.id)}
                          disabled={isSavingCounselor}
                          className="text-success hover:text-success-hover"
                          aria-label="Save"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditingCounselor}
                          disabled={isSavingCounselor}
                          className="text-text-muted hover:text-text-default"
                          aria-label="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditingCounselor(row)}
                        disabled={isReadOnly}
                        className={`flex items-center gap-1 text-left ${
                          isReadOnly ? 'cursor-not-allowed opacity-50' : 'hover:text-text-default'
                        }`}
                      >
                        {row.counselor_email ? (
                          <span className="truncate max-w-[120px]" title={row.counselor_email}>
                            {row.counselor_email}
                          </span>
                        ) : (
                          <span className="text-text-muted italic">Add</span>
                        )}
                        {!isReadOnly && <Pencil className="h-3 w-3 flex-shrink-0" />}
                      </button>
                    )}
                  </DataTableCell>
                  <DataTableCell align="center">
                    {row.joined && (
                      <Check className="mx-auto h-5 w-5 text-success" aria-hidden="true" />
                    )}
                  </DataTableCell>
                  <DataTableCell align="right">
                    <button
                      type="button"
                      className={[
                        'text-danger hover:text-danger-hover',
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
                <EmptyStateRow colSpan={7} message="No students on the roster" />
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
