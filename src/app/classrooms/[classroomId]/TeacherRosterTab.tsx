'use client'

import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button, ConfirmDialog, SplitButton, type SplitButtonOption, useAppMessage } from '@/ui'
import { UploadRosterModal } from '@/components/UploadRosterModal'
import { AddStudentsModal } from '@/components/AddStudentsModal'
import { TeacherWorkSurfaceActionBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionBar'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import { TeacherWorkspaceSplit } from '@/components/teacher-work-surface/TeacherWorkspaceSplit'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  DataTableHeaderCell,
  EmptyStateRow,
  KeyboardNavigableTable,
  SortableHeaderCell,
  TableCard,
} from '@/components/DataTable'
import type { Classroom } from '@/types'
import { Check, Pencil, X } from 'lucide-react'
import { CountBadge, StudentCountBadge } from '@/components/StudentCountBadge'
import { compareByNameFields, toggleSort } from '@/lib/table-sort'
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

function getRosterName(row: RosterRow): string {
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email
}

function formatRosterDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('en-CA', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/Toronto',
    }).format(new Date(iso))
  } catch {
    return iso
  }
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
  const [selectedRosterId, setSelectedRosterId] = useState<string | null>(null)
  const [detailPaneWidth, setDetailPaneWidth] = useState(50)

  // Selection state
  const { showMessage } = useAppMessage()

  // Counselor email editing state
  const [editingCounselorId, setEditingCounselorId] = useState<string | null>(null)
  const [editingCounselorValue, setEditingCounselorValue] = useState('')
  const [isSavingCounselor, setIsSavingCounselor] = useState(false)

  const sortedRoster = useMemo(() => {
    const rows = [...roster]
    rows.sort((a, b) =>
      compareByNameFields(
        { firstName: a.first_name, lastName: a.last_name, id: a.email },
        { firstName: b.first_name, lastName: b.last_name, id: b.email },
        sortColumn,
        sortDirection
      )
    )
    return rows
  }, [roster, sortColumn, sortDirection])

  const rosterIds = useMemo(() => sortedRoster.map((r) => r.id), [sortedRoster])
  const joinedCount = useMemo(() => sortedRoster.filter((r) => r.joined).length, [sortedRoster])
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
  const selectedRosterRow = sortedRoster.find((row) => row.id === selectedRosterId) ?? null

  useEffect(() => {
    if (selectedRosterId && !roster.some((row) => row.id === selectedRosterId)) {
      setSelectedRosterId(null)
    }
  }, [roster, selectedRosterId])

  async function copyToClipboard(emails: string[], label: string) {
    const text = emails.join(', ')
    try {
      await navigator.clipboard.writeText(text)
      showMessage({ text: `${label} copied`, tone: 'success' })
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      showMessage({ text: `${label} copied`, tone: 'success' })
    }
  }

  function openGmail(emails: string[]) {
    const validEmails = emails.filter((e) => e && e.includes('@'))
    if (validEmails.length === 0) return
    const bcc = validEmails.join(',')
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&bcc=${encodeURIComponent(bcc)}`, '_blank')
  }

  function openOutlook(emails: string[]) {
    const validEmails = emails.filter((e) => e && e.includes('@'))
    if (validEmails.length === 0) return
    const bcc = validEmails.join(',')
    window.open(`https://outlook.office.com/mail/deeplink/compose?bcc=${encodeURIComponent(bcc)}`, '_blank')
  }

  function openDefaultEmail(emails: string[]) {
    const validEmails = emails.filter((e) => e && e.includes('@'))
    if (validEmails.length === 0) return
    window.location.href = `mailto:?bcc=${encodeURIComponent(validEmails.join(','))}`
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

  const rosterActionOptions: SplitButtonOption[] = someSelected
    ? [
        {
          id: 'add-students',
          label: '+ Students',
          onSelect: () => setAddModalOpen(true),
          disabled: isReadOnly || loading,
        },
        {
          id: 'upload-csv',
          label: '+ CSV',
          onSelect: () => setUploadModalOpen(true),
          disabled: isReadOnly || loading,
        },
      ]
    : [
        {
          id: 'upload-csv',
          label: '+ CSV',
          onSelect: () => setUploadModalOpen(true),
          disabled: isReadOnly || loading,
        },
      ]

  if (!someSelected) {
    rosterActionOptions.push({
      id: 'email-placeholder',
      label: 'Select students to email',
      onSelect: () => {},
      disabled: true,
    })
  } else {
    rosterActionOptions.push(
      {
        id: 'copy-student-emails',
        label: `Copy emails (${selectedStudentEmails.length})`,
        onSelect: () => copyToClipboard(selectedStudentEmails, 'Student emails'),
      },
      {
        id: 'gmail-students',
        label: 'Gmail',
        onSelect: () => openGmail(selectedStudentEmails),
      },
      {
        id: 'outlook-students',
        label: 'Outlook',
        onSelect: () => openOutlook(selectedStudentEmails),
      },
    )

    if (selectedCounselorEmails.length > 0) {
      const allEmails = [...selectedStudentEmails, ...selectedCounselorEmails]
      rosterActionOptions.push(
        {
          id: 'copy-counselor-emails',
          label: `Copy counselors (${selectedCounselorEmails.length})`,
          onSelect: () => copyToClipboard(selectedCounselorEmails, 'Counselor emails'),
        },
        {
          id: 'copy-all-emails',
          label: `Copy all emails (${allEmails.length})`,
          onSelect: () => copyToClipboard(allEmails, 'All emails'),
        },
        {
          id: 'gmail-all',
          label: 'Gmail all',
          onSelect: () => openGmail(allEmails),
        },
        {
          id: 'outlook-all',
          label: 'Outlook all',
          onSelect: () => openOutlook(allEmails),
        },
      )
    }
  }

  const actionBar = (
    <TeacherWorkSurfaceActionBar
      center={
        <SplitButton
          label={someSelected ? `Email (${selectedStudentEmails.length})` : '+ Students'}
          onPrimaryClick={() => {
            if (someSelected) {
              openDefaultEmail(selectedStudentEmails)
              return
            }
            if (isReadOnly || loading) return
            setAddModalOpen(true)
          }}
          options={rosterActionOptions}
          disabled={!someSelected && (isReadOnly || loading)}
          size="sm"
          toggleAriaLabel="Roster actions"
          menuPlacement="down"
        />
      }
      centerPlacement="floating"
    />
  )

  const detailPane = selectedRosterRow ? (
    <div className="space-y-4 p-4">
      <div className="rounded-md border border-border bg-surface-2 p-3">
        <div className="text-xs text-text-muted">Student email</div>
        <div className="mt-1 break-all text-sm font-medium text-text-default">{selectedRosterRow.email}</div>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <div className="text-xs text-text-muted">First</div>
          <div className="text-text-default">{selectedRosterRow.first_name || '—'}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Last</div>
          <div className="text-text-default">{selectedRosterRow.last_name || '—'}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Student number</div>
          <div className="text-text-default">{selectedRosterRow.student_number || '—'}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Joined</div>
          <div className="text-text-default">{selectedRosterRow.joined ? 'Yes' : 'No'}</div>
        </div>
      </div>
      <div>
        <div className="text-xs text-text-muted">Counselor</div>
        <div className="break-all text-sm text-text-default">{selectedRosterRow.counselor_email || '—'}</div>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <div className="text-xs text-text-muted">Added</div>
          <div className="text-text-default">{formatRosterDate(selectedRosterRow.created_at)}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Joined at</div>
          <div className="text-text-default">{formatRosterDate(selectedRosterRow.joined_at)}</div>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="danger"
        disabled={isReadOnly}
        onClick={() => {
          setPendingRemoval({
            rosterId: selectedRosterRow.id,
            email: selectedRosterRow.email,
            firstName: selectedRosterRow.first_name,
            lastName: selectedRosterRow.last_name,
            joined: selectedRosterRow.joined,
          })
        }}
      >
        Remove
      </Button>
    </div>
  ) : (
    <div className="space-y-4 p-4">
      <div className="rounded-md border border-border bg-surface-2 p-3">
        <div className="text-xs text-text-muted">Roster size</div>
        <div className="mt-1 text-lg font-semibold text-text-default">{sortedRoster.length}</div>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <div className="text-xs text-text-muted">Joined</div>
          <div className="text-text-default">{joinedCount}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Not joined</div>
          <div className="text-text-default">{Math.max(sortedRoster.length - joinedCount, 0)}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Selected</div>
          <div className="text-text-default">{selectedIds.size}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Counselors</div>
          <div className="text-text-default">{sortedRoster.filter((row) => row.counselor_email).length}</div>
        </div>
      </div>
    </div>
  )

  const workspace = loading ? (
    <div className="flex flex-1 justify-center py-12">
      <Spinner size="lg" />
    </div>
  ) : (
    <TeacherWorkspaceSplit
      className="flex-1"
      splitVariant="gapped"
      primaryClassName="min-h-[200px] rounded-lg bg-surface"
      inspectorClassName="flex flex-col rounded-lg bg-surface"
      inspectorCollapsed={false}
      inspectorWidth={detailPaneWidth}
      minInspectorPx={280}
      minPrimaryPx={320}
      minInspectorPercent={28}
      maxInspectorPercent={72}
      defaultInspectorWidth={50}
      onInspectorWidthChange={setDetailPaneWidth}
      dividerLabel="Resize Roster panes"
      primary={
        <div className="h-full min-h-0 overflow-auto">
          <TableCard chrome="flush" overflowX>
            {error && (
              <div className="p-3 border-b border-border">
                <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
                  {error}
                </div>
              </div>
            )}

            <KeyboardNavigableTable
              rowKeys={rosterIds}
              selectedKey={selectedRosterId}
              onSelectKey={setSelectedRosterId}
              onDeselect={() => setSelectedRosterId(null)}
            >
              <DataTable density="tight">
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
                      label="First"
                      isActive={sortColumn === 'first_name'}
                      direction={sortDirection}
                      onClick={() => onSort('first_name')}
                      trailing={sortedRoster.length > 0 ? <StudentCountBadge count={sortedRoster.length} variant="neutral" /> : undefined}
                    />
                    <SortableHeaderCell
                      label="Last"
                      isActive={sortColumn === 'last_name'}
                      direction={sortDirection}
                      onClick={() => onSort('last_name')}
                    />
                    <DataTableHeaderCell className="hidden md:table-cell">Email</DataTableHeaderCell>
                    <DataTableHeaderCell className="hidden lg:table-cell">Counselor</DataTableHeaderCell>
                    <DataTableHeaderCell align="center">
                      <span className="flex items-center justify-center gap-2">
                        Joined
                        <CountBadge count={joinedCount} tooltip={`${joinedCount} ${joinedCount === 1 ? 'student' : 'students'} joined`} variant="success" />
                      </span>
                    </DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {sortedRoster.map((row) => {
                    const isSelected = row.id === selectedRosterId
                    return (
                      <DataTableRow
                        key={row.id}
                        className={[
                          'cursor-pointer transition-colors',
                          isSelected ? 'bg-info-bg hover:bg-info-bg-hover' : 'hover:bg-surface-hover',
                        ].join(' ')}
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest('button,input,a')) return
                          setSelectedRosterId(isSelected ? null : row.id)
                        }}
                      >
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
                        <DataTableCell className="hidden text-text-muted md:table-cell">{row.email}</DataTableCell>
                        <DataTableCell className="hidden text-text-muted lg:table-cell">
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
                      </DataTableRow>
                    )
                  })}
                  {sortedRoster.length === 0 && (
                    <EmptyStateRow colSpan={6} message="No students on the roster" />
                  )}
                </DataTableBody>
              </DataTable>
            </KeyboardNavigableTable>
          </TableCard>
        </div>
      }
      inspector={
        <>
          <div className="flex min-h-10 items-center border-b border-border px-3 py-2">
            <span className="truncate text-sm font-semibold text-text-default">
              {selectedRosterRow ? getRosterName(selectedRosterRow) : 'Roster Summary'}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {detailPane}
          </div>
        </>
      }
    />
  )

  return (
    <>
      <TeacherWorkSurfaceShell
        state="workspace"
        workspaceFrame="standalone"
        primary={actionBar}
        summary={null}
        workspace={workspace}
        workspaceFrameClassName="min-h-[360px] border-0 bg-page"
      />

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
    </>
  )
}
