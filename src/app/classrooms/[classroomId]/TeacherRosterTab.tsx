'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import {
  Button,
  ConfirmDialog,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyStateRow,
  KeyboardNavigableTable,
  SortableHeaderCell,
  TableCard,
  useAppMessage,
} from '@/ui'
import { UploadRosterModal } from '@/components/UploadRosterModal'
import { AddStudentsModal } from '@/components/AddStudentsModal'
import { TeacherWorkSurfaceActionBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionBar'
import {
  TeacherWorkSurfaceActionCluster,
  TeacherWorkSurfaceIconMenuButton,
  type TeacherWorkSurfaceActionItem,
} from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import type { Classroom, RosterJoinSource } from '@/types'
import { Check, Copy, Mail, Pencil, Plus, Settings, X } from 'lucide-react'
import { CountBadge, StudentCountBadge } from '@/components/StudentCountBadge'
import { compareByNameFields, toggleSort } from '@/lib/table-sort'
import { useStudentSelection } from '@/hooks/useStudentSelection'
import { useScrollPositionMemory } from '@/hooks/useScrollPositionMemory'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'

type Role = 'student' | 'teacher'

const getRosterStudentRowId = (rosterId: string) => `roster-student-row-${rosterId}`

interface RosterRow {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  student_number: string | null
  counselor_email: string | null
  join_source: RosterJoinSource
  created_at: string
  updated_at: string
  joined: boolean
  student_id: string | null
  joined_at: string | null
}

interface RemovalTarget {
  rosterId: string
  email: string
  firstName: string | null
  lastName: string | null
  joined: boolean
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
      join_source: row.join_source === 'open_join' || row.join_source === 'csv' ? row.join_source : 'manual',
      created_at: row.created_at,
      updated_at: row.updated_at,
      joined: !!row.joined,
      student_id: row.student_id ?? null,
      joined_at: row.joined_at ?? null,
    } satisfies RosterRow
  })
}

function JoinSourceBadge({ source }: { source: RosterJoinSource }) {
  if (source !== 'open_join') return null

  return (
    <span className="inline-flex shrink-0 rounded-badge border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-muted">
      Open join
    </span>
  )
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
    rows: RemovalTarget[]
  } | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [selectedRosterId, setSelectedRosterId] = useState<string | null>(null)
  const [loadedClassroomId, setLoadedClassroomId] = useState<string | null>(null)
  const loadRequestIdRef = useRef(0)
  const currentClassroomIdRef = useRef(classroom.id)
  currentClassroomIdRef.current = classroom.id

  // Selection state
  const { showMessage } = useAppMessage()

  // Counselor email editing state
  const [editingCounselorId, setEditingCounselorId] = useState<string | null>(null)
  const [editingCounselorValue, setEditingCounselorValue] = useState('')
  const [isSavingCounselor, setIsSavingCounselor] = useState(false)

  const hasCurrentRoster = loadedClassroomId === classroom.id
  const currentRoster = useMemo(
    () => (hasCurrentRoster ? roster : []),
    [hasCurrentRoster, roster],
  )

  const sortedRoster = useMemo(() => {
    const rows = [...currentRoster]
    rows.sort((a, b) =>
      compareByNameFields(
        { firstName: a.first_name, lastName: a.last_name, id: a.email },
        { firstName: b.first_name, lastName: b.last_name, id: b.email },
        sortColumn,
        sortDirection
      )
    )
    return rows
  }, [currentRoster, sortColumn, sortDirection])

  const rosterIds = useMemo(() => sortedRoster.map((r) => r.id), [sortedRoster])
  const joinedCount = useMemo(() => sortedRoster.filter((r) => r.joined).length, [sortedRoster])
  const { selectedIds, toggleSelect, toggleSelectAll, allSelected, clearSelection } = useStudentSelection(rosterIds)
  const isRosterLoading = loading || !hasCurrentRoster

  function onSort(column: 'first_name' | 'last_name') {
    setSortState((prev) => toggleSort(prev, column))
  }

  async function loadRoster() {
    const classroomId = classroom.id
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    setLoading(true)
    setError('')
    try {
      const data = await fetchJSONWithCache(
        `teacher-roster:${classroomId}`,
        async () => {
          const res = await fetch(`/api/teacher/classrooms/${classroomId}/roster`)
          const data = await res.json()
          if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
              try {
                const meData = await fetchJSONWithCache(
                  'auth-me:roster-error',
                  async () => {
                    const meRes = await fetch('/api/auth/me')
                    return meRes.json().catch(() => ({}))
                  },
                  2_000,
                )
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
          return data
        },
        20_000,
      )
      if (loadRequestIdRef.current !== requestId || currentClassroomIdRef.current !== classroomId) return
      setRoster(normalizeRosterRows(data.roster || []))
      setLoadedClassroomId(classroomId)
      clearSelection()
    } catch (err: any) {
      if (loadRequestIdRef.current !== requestId || currentClassroomIdRef.current !== classroomId) return
      setRoster([])
      setLoadedClassroomId(classroomId)
      setError(err.message || 'Failed to load roster')
    } finally {
      if (loadRequestIdRef.current === requestId && currentClassroomIdRef.current === classroomId) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    loadRequestIdRef.current += 1
    setRoster([])
    setLoadedClassroomId(null)
    setError('')
    setPendingRemoval(null)
    setSelectedRosterId(null)
    setUploadModalOpen(false)
    setAddModalOpen(false)
    setIsRemoving(false)
    setEditingCounselorId(null)
    setEditingCounselorValue('')
    setIsSavingCounselor(false)
    loadRoster()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroom.id])

  async function confirmRemoveStudent() {
    if (!pendingRemoval || pendingRemoval.rows.length === 0) return
    if (isReadOnly) return
    const classroomId = classroom.id
    setIsRemoving(true)
    setError('')
    const fallbackError = pendingRemoval.rows.length > 1 ? 'Failed to remove students' : 'Failed to remove student'

    try {
      const res = await fetch(`/api/teacher/classrooms/${classroomId}/roster/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roster_ids: pendingRemoval.rows.map((row) => row.rosterId) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || fallbackError)
      }
      invalidateCachedJSON(`teacher-roster:${classroomId}`)
      if (currentClassroomIdRef.current !== classroomId) return
      setPendingRemoval(null)
      await loadRoster()
    } catch (err: any) {
      if (currentClassroomIdRef.current !== classroomId) return
      setError(err.message || fallbackError)
    } finally {
      if (currentClassroomIdRef.current === classroomId) {
        setIsRemoving(false)
      }
    }
  }

  const someSelected = selectedIds.size > 0

  // Get emails for selected students
  const selectedRows = sortedRoster.filter((r) => selectedIds.has(r.id))
  const selectedStudentEmails = selectedRows.map((r) => r.email)
  const selectedCounselorEmails = selectedRows.map((r) => r.counselor_email).filter(Boolean) as string[]
  const selectedRosterRow = sortedRoster.find((row) => row.id === selectedRosterId) ?? null
  const removalTargetRows = selectedRows.length > 0 ? selectedRows : selectedRosterRow ? [selectedRosterRow] : []
  const {
    scrollRef: rosterTableScrollRef,
    preserveScrollPosition: preserveRosterTableScrollPosition,
  } = useScrollPositionMemory<HTMLDivElement>({
    key: `${classroom.id}:roster`,
    enabled: !isRosterLoading,
    restoreToken: [
      selectedRosterId ?? 'none',
      sortedRoster.length,
      isRosterLoading ? 'loading' : 'ready',
    ].join(':'),
  })
  const selectRosterId = useCallback((nextRosterId: string | null) => {
    preserveRosterTableScrollPosition()
    setSelectedRosterId(nextRosterId)
  }, [preserveRosterTableScrollPosition])

  useEffect(() => {
    if (selectedRosterId && !currentRoster.some((row) => row.id === selectedRosterId)) {
      setSelectedRosterId(null)
    }
  }, [currentRoster, selectedRosterId])

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
    const classroomId = classroom.id
    setIsSavingCounselor(true)
    setError('')

    try {
      const res = await fetch(`/api/teacher/classrooms/${classroomId}/roster/${rosterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counselor_email: editingCounselorValue.trim() || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update counselor email')
      }
      invalidateCachedJSON(`teacher-roster:${classroomId}`)
      if (currentClassroomIdRef.current !== classroomId) return
      // Update local state
      setRoster((prev) =>
        prev.map((r) =>
          r.id === rosterId ? { ...r, counselor_email: editingCounselorValue.trim() || null } : r
        )
      )
      setEditingCounselorId(null)
      setEditingCounselorValue('')
    } catch (err: any) {
      if (currentClassroomIdRef.current !== classroomId) return
      setError(err.message || 'Failed to update counselor email')
    } finally {
      if (currentClassroomIdRef.current === classroomId) {
        setIsSavingCounselor(false)
      }
    }
  }

  function toRemovalTarget(row: RosterRow): RemovalTarget {
    return {
      rosterId: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      joined: row.joined,
    }
  }

  function openRemoveStudentDialog(rows: RosterRow[]) {
    if (rows.length === 0 || isReadOnly) return
    setPendingRemoval({ rows: rows.map(toRemovalTarget) })
  }

  function refreshRosterAfterMutation() {
    invalidateCachedJSON(`teacher-roster:${classroom.id}`)
    void loadRoster()
  }

  function getRemovalMenuLabel(rowCount: number) {
    return rowCount > 1 ? 'Remove students' : 'Remove student'
  }

  function formatRemovalTargetName(row: RemovalTarget) {
    return [row.firstName, row.lastName].filter(Boolean).join(' ') || 'Unnamed student'
  }

  function getRemovalDescription(rows: RemovalTarget[]) {
    if (rows.length === 0) return undefined

    if (rows.length === 1) {
      const row = rows[0]
      return `${formatRemovalTargetName(row)}\n${row.email}\n\n${
        row.joined
          ? 'They are currently joined. This will delete their classroom data (logs and assignment docs).'
          : 'They are not joined yet.'
      }`
    }

    const previewRows = rows.slice(0, 5)
    const preview = previewRows.map((row) => `${formatRemovalTargetName(row)} - ${row.email}`).join('\n')
    const remaining = rows.length > previewRows.length ? `\n+ ${rows.length - previewRows.length} more` : ''
    const joinedCount = rows.filter((row) => row.joined).length

    return `${preview}${remaining}\n\n${
      joinedCount > 0
        ? `${joinedCount} ${joinedCount === 1 ? 'student is' : 'students are'} currently joined. This will delete their classroom data (logs and assignment docs).`
        : 'These students are not joined yet.'
    }`
  }

  const rosterActionOptions: TeacherWorkSurfaceActionItem[] = [
    {
      id: 'upload-csv',
      label: '+ CSV',
      onSelect: () => setUploadModalOpen(true),
      disabled: isReadOnly || isRosterLoading,
    },
  ]

  if (removalTargetRows.length > 0) {
    rosterActionOptions.push({
      id: 'remove-student',
      label: <span className="text-danger">{getRemovalMenuLabel(removalTargetRows.length)}</span>,
      onSelect: () => openRemoveStudentDialog(removalTargetRows),
      disabled: isReadOnly || isRosterLoading || isRemoving || removalTargetRows.length === 0,
      destructive: true,
    })
  }

  const selectedEmailOptions: TeacherWorkSurfaceActionItem[] = [
    {
      id: 'copy-student-emails',
      label: `Copy emails (${selectedStudentEmails.length})`,
      icon: <Copy className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => copyToClipboard(selectedStudentEmails, 'Student emails'),
      disabled: selectedStudentEmails.length === 0,
    },
    {
      id: 'gmail-students',
      label: 'Gmail',
      icon: <Mail className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => openGmail(selectedStudentEmails),
      disabled: selectedStudentEmails.length === 0,
    },
    {
      id: 'outlook-students',
      label: 'Outlook',
      icon: <Mail className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => openOutlook(selectedStudentEmails),
      disabled: selectedStudentEmails.length === 0,
    },
  ]

  if (selectedCounselorEmails.length > 0) {
    const allEmails = [...selectedStudentEmails, ...selectedCounselorEmails]
    selectedEmailOptions.push(
      {
        id: 'copy-counselor-emails',
        label: `Copy counselors (${selectedCounselorEmails.length})`,
        icon: <Copy className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => copyToClipboard(selectedCounselorEmails, 'Counselor emails'),
        dividerBefore: true,
      },
      {
        id: 'copy-all-emails',
        label: `Copy all emails (${allEmails.length})`,
        icon: <Copy className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => copyToClipboard(allEmails, 'All emails'),
      },
      {
        id: 'gmail-all',
        label: 'Gmail all',
        icon: <Mail className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => openGmail(allEmails),
      },
      {
        id: 'outlook-all',
        label: 'Outlook all',
        icon: <Mail className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => openOutlook(allEmails),
      },
    )
  }
  const combinedRosterActionOptions: TeacherWorkSurfaceActionItem[] = [
    ...rosterActionOptions,
    ...(someSelected
      ? selectedEmailOptions.map((option, index) => ({
          ...option,
          dividerBefore: index === 0 ? true : option.dividerBefore,
        }))
      : []),
  ]

  const actionBar = (
    <TeacherWorkSurfaceActionBar
      center={
        <TeacherWorkSurfaceActionCluster>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => {
              if (isReadOnly || isRosterLoading) return
              setAddModalOpen(true)
            }}
            disabled={isReadOnly || isRosterLoading}
            aria-label="Add students"
          >
            <span className="inline-flex items-center gap-2 whitespace-nowrap">
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Students</span>
            </span>
          </Button>
          <TeacherWorkSurfaceIconMenuButton
            ariaLabel="Roster actions"
            tooltip="Roster actions"
            icon={<Settings className="h-4 w-4" aria-hidden="true" />}
            items={combinedRosterActionOptions}
            disabled={isReadOnly || isRosterLoading}
            menuPlacement="down"
            menuAlign="center"
            menuClassName="w-64"
          />
        </TeacherWorkSurfaceActionCluster>
      }
      centerPlacement="floating"
    />
  )

  const workspace = isRosterLoading ? (
    <div className="flex flex-1 justify-center py-12">
      <Spinner size="lg" />
    </div>
  ) : (
    <div
      ref={rosterTableScrollRef}
      className="min-h-[200px] flex-1 overflow-auto rounded-lg bg-surface"
      data-testid="roster-student-scroll-pane"
      onScroll={preserveRosterTableScrollPosition}
    >
      <TableCard chrome="flush" overflowX>
        {error && (
          <div className="border-b border-border p-3">
            <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </div>
          </div>
        )}

        <KeyboardNavigableTable
          ariaLabel="Classroom roster"
          rowKeys={rosterIds}
          selectedKey={selectedRosterId}
          onSelectKey={selectRosterId}
          onDeselect={() => selectRosterId(null)}
          getRowId={getRosterStudentRowId}
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
                    id={getRosterStudentRowId(row.id)}
                    aria-selected={isSelected}
                    tabIndex={-1}
                    className={[
                      'cursor-pointer transition-colors',
                      isSelected ? 'bg-info-bg hover:bg-info-bg-hover' : 'hover:bg-surface-hover',
                    ].join(' ')}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('button,input,a')) return
                      selectRosterId(isSelected ? null : row.id)
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
                    <DataTableCell className="hidden text-text-muted md:table-cell">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{row.email}</span>
                        <JoinSourceBadge source={row.join_source} />
                      </div>
                    </DataTableCell>
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
        onSuccess={refreshRosterAfterMutation}
      />

      <UploadRosterModal
        isOpen={isUploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        classroomId={classroom.id}
        onSuccess={refreshRosterAfterMutation}
      />

      <ConfirmDialog
        isOpen={!!pendingRemoval}
        title={pendingRemoval && pendingRemoval.rows.length > 1 ? 'Remove students?' : 'Remove student?'}
        description={pendingRemoval ? getRemovalDescription(pendingRemoval.rows) : undefined}
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
