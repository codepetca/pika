'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  ConfirmDialog,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  EmptyStateRow,
  FormField,
  KeyboardNavigableTable,
  Input,
  PageState,
  SortableHeaderCell,
  TableCard,
  TableSelectionCell,
  TableSelectionHeaderCell,
  useAppMessage,
} from '@/ui'
import { UploadRosterModal } from '@/components/UploadRosterModal'
import { AddStudentsModal } from '@/components/AddStudentsModal'
import { StudentPurgeDialog } from '@/components/StudentPurgeDialog'
import { TeacherWorkSurfaceContextBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceContextBar'
import {
  TeacherWorkSurfaceActionCluster,
  TeacherWorkSurfaceIconMenuButton,
  type TeacherWorkSurfaceActionItem,
} from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import type { Classroom, RosterJoinSource } from '@/types'
import { Check, Copy, Mail, Pencil, Plus, Settings, X } from 'lucide-react'
import { CountBadge, StudentCountBadge } from '@/components/StudentCountBadge'
import { applyDirection, compareByNameFields, compareNullableStrings, toggleSort } from '@/lib/table-sort'
import { useTableSelection } from '@/hooks/useTableSelection'
import { useTableColumnWidths } from '@/hooks/useTableColumnWidths'
import { useScrollPositionMemory } from '@/hooks/useScrollPositionMemory'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'

type Role = 'student' | 'teacher'
type RosterSortColumn = 'first_name' | 'last_name' | 'email' | 'counselor_email' | 'joined'
type RosterResizableColumn = 'first' | 'last' | 'email' | 'counselor'

const ROSTER_COLUMN_LIMITS = {
  first: { defaultWidth: 96, min: 64, max: 200 },
  last: { defaultWidth: 96, min: 64, max: 200 },
  email: { defaultWidth: 240, min: 160, max: 360 },
  counselor: { defaultWidth: 180, min: 140, max: 300 },
} satisfies Record<RosterResizableColumn, { defaultWidth: number; min: number; max: number }>

const getRosterStudentRowId = (rosterId: string) => `roster-student-row-${rosterId}`
const getCounselorEditButtonId = (rosterId: string) => `roster-counselor-edit-${rosterId}`

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
  const [isRetryingRoster, setIsRetryingRoster] = useState(false)
  const [roster, setRoster] = useState<RosterRow[]>([])
  const [studentPurgeEnabledIds, setStudentPurgeEnabledIds] = useState<Set<string>>(new Set())
  const [loadError, setLoadError] = useState<string>('')
  const [isUploadModalOpen, setUploadModalOpen] = useState(false)
  const [isAddModalOpen, setAddModalOpen] = useState(false)
  const [{ column: sortColumn, direction: sortDirection }, setSortState] = useState<{
    column: RosterSortColumn
    direction: 'asc' | 'desc'
  }>({ column: 'last_name', direction: 'asc' })
  const [pendingRemoval, setPendingRemoval] = useState<{
    rows: RemovalTarget[]
  } | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [removalError, setRemovalError] = useState('')
  const [pendingPurge, setPendingPurge] = useState<RosterRow | null>(null)
  const [selectedRosterId, setSelectedRosterId] = useState<string | null>(null)
  const [loadedClassroomId, setLoadedClassroomId] = useState<string | null>(null)
  const loadRequestIdRef = useRef(0)
  const rosterMutationVersionRef = useRef(0)
  const classroomEpochRef = useRef(0)
  const currentClassroomIdRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    const committedClassroomId = classroom.id
    currentClassroomIdRef.current = committedClassroomId
    return () => {
      if (currentClassroomIdRef.current === committedClassroomId) {
        currentClassroomIdRef.current = null
      }
    }
  }, [classroom.id])

  // Selection state
  const { showMessage } = useAppMessage()

  // Counselor email editing state
  const [editingCounselorId, setEditingCounselorId] = useState<string | null>(null)
  const [editingCounselorValue, setEditingCounselorValue] = useState('')
  const [savingCounselor, setSavingCounselor] = useState<{
    rosterId: string
    editEpoch: number
  } | null>(null)
  const [counselorError, setCounselorError] = useState<{
    rosterId: string
    message: string
  } | null>(null)
  const counselorEditEpochRef = useRef(0)
  const pendingCounselorRosterIdsRef = useRef<Set<string>>(new Set())
  const [pendingCounselorRosterIds, setPendingCounselorRosterIds] = useState<Set<string>>(new Set())
  const rosterRegionRef = useRef<HTMLDivElement>(null)
  const retryFocusIntentRef = useRef(false)

  const hasCurrentRoster = loadedClassroomId === classroom.id
  const currentRoster = useMemo(
    () => (hasCurrentRoster ? roster : []),
    [hasCurrentRoster, roster],
  )

  const sortedRoster = useMemo(() => {
    const rows = [...currentRoster]
    rows.sort((a, b) => {
      if (sortColumn === 'first_name' || sortColumn === 'last_name') {
        return compareByNameFields(
        { firstName: a.first_name, lastName: a.last_name, id: a.email },
        { firstName: b.first_name, lastName: b.last_name, id: b.email },
        sortColumn,
        sortDirection
        )
      }
      if (sortColumn === 'email') {
        return applyDirection(a.email.localeCompare(b.email), sortDirection)
      }
      if (sortColumn === 'counselor_email') {
        return applyDirection(
          compareNullableStrings(a.counselor_email, b.counselor_email),
          sortDirection,
        )
      }
      return applyDirection(Number(a.joined) - Number(b.joined), sortDirection)
    })
    return rows
  }, [currentRoster, sortColumn, sortDirection])

  const rosterIds = useMemo(() => sortedRoster.map((r) => r.id), [sortedRoster])
  const joinedCount = useMemo(() => sortedRoster.filter((r) => r.joined).length, [sortedRoster])
  const {
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    allSelected,
    someSelected: selectionIndeterminate,
    clearSelection,
  } = useTableSelection(rosterIds)
  const { columnWidths, setColumnWidth } = useTableColumnWidths({
    storageKey: 'teacher-roster:v1',
    columns: ROSTER_COLUMN_LIMITS,
  })
  const isRosterLoading = loading || !hasCurrentRoster
  const isRosterUnavailable = !hasCurrentRoster

  function onSort(column: RosterSortColumn) {
    setSortState((prev) => toggleSort(prev, column))
  }

  async function loadRoster({
    preserveRoster = false,
    isRetry = false,
  }: {
    preserveRoster?: boolean
    isRetry?: boolean
  } = {}) {
    const classroomId = classroom.id
    const requestId = loadRequestIdRef.current + 1
    const mutationVersion = rosterMutationVersionRef.current
    loadRequestIdRef.current = requestId
    setLoading(true)
    setIsRetryingRoster(isRetry)
    if (!isRetry) setLoadError('')
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
      if (
        loadRequestIdRef.current !== requestId
        || currentClassroomIdRef.current !== classroomId
        || rosterMutationVersionRef.current !== mutationVersion
      ) return
      setRoster(normalizeRosterRows(data.roster || []))
      setStudentPurgeEnabledIds(new Set(data.student_purge_enabled_ids || []))
      setLoadedClassroomId(classroomId)
      setLoadError('')
      clearSelection()
    } catch (err: any) {
      if (
        loadRequestIdRef.current !== requestId
        || currentClassroomIdRef.current !== classroomId
        || rosterMutationVersionRef.current !== mutationVersion
      ) return
      if (!preserveRoster) {
        setRoster([])
        setStudentPurgeEnabledIds(new Set())
        setLoadedClassroomId(null)
      }
      setLoadError(err.message || 'Failed to load roster')
    } finally {
      if (loadRequestIdRef.current === requestId && currentClassroomIdRef.current === classroomId) {
        setLoading(false)
        setIsRetryingRoster(false)
      }
    }
  }

  useEffect(() => {
    classroomEpochRef.current += 1
    rosterMutationVersionRef.current += 1
    counselorEditEpochRef.current += 1
    loadRequestIdRef.current += 1
    setRoster([])
    setStudentPurgeEnabledIds(new Set())
    setLoadedClassroomId(null)
    setLoadError('')
    setIsRetryingRoster(false)
    setPendingRemoval(null)
    setRemovalError('')
    setSelectedRosterId(null)
    setUploadModalOpen(false)
    setAddModalOpen(false)
    setIsRemoving(false)
    setPendingPurge(null)
    setEditingCounselorId(null)
    setEditingCounselorValue('')
    setSavingCounselor(null)
    pendingCounselorRosterIdsRef.current = new Set()
    setPendingCounselorRosterIds(new Set())
    setCounselorError(null)
    retryFocusIntentRef.current = false
    loadRoster()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroom.id])

  async function confirmRemoveStudent() {
    if (!pendingRemoval || pendingRemoval.rows.length === 0) return
    if (isReadOnly) return
    const classroomId = classroom.id
    const classroomEpoch = classroomEpochRef.current
    const removalRosterIds = pendingRemoval.rows.map((row) => row.rosterId)
    setIsRemoving(true)
    setRemovalError('')
    const fallbackError = pendingRemoval.rows.length > 1 ? 'Failed to remove students' : 'Failed to remove student'

    try {
      const res = await fetch(`/api/teacher/classrooms/${classroomId}/roster/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roster_ids: removalRosterIds }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || fallbackError)
      }
      invalidateCachedJSON(`teacher-roster:${classroomId}`)
      if (
        currentClassroomIdRef.current !== classroomId
        || classroomEpochRef.current !== classroomEpoch
      ) return
      rosterMutationVersionRef.current += 1
      setPendingRemoval(null)
      setRemovalError('')
      setRoster((current) => current.filter((row) => !removalRosterIds.includes(row.id)))
      if (selectedRosterId && removalRosterIds.includes(selectedRosterId)) {
        setSelectedRosterId(null)
      }
      clearSelection()
      await loadRoster({ preserveRoster: true })
    } catch (err: any) {
      if (
        currentClassroomIdRef.current !== classroomId
        || classroomEpochRef.current !== classroomEpoch
      ) return
      setRemovalError(err.message || fallbackError)
    } finally {
      if (
        currentClassroomIdRef.current === classroomId
        && classroomEpochRef.current === classroomEpoch
      ) {
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
  const counselorErrorRow = counselorError
    ? sortedRoster.find((row) => row.id === counselorError.rosterId) ?? null
    : null
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
    if (isReadOnly || pendingCounselorRosterIdsRef.current.has(row.id)) return
    counselorEditEpochRef.current += 1
    setEditingCounselorId(row.id)
    setEditingCounselorValue(row.counselor_email || '')
    setCounselorError(null)
  }

  function focusCounselorEditButton(rosterId: string) {
    window.setTimeout(() => {
      document.getElementById(getCounselorEditButtonId(rosterId))?.focus()
    }, 0)
  }

  function cancelEditingCounselor(rosterId: string) {
    counselorEditEpochRef.current += 1
    setEditingCounselorId(null)
    setEditingCounselorValue('')
    setCounselorError(null)
    focusCounselorEditButton(rosterId)
  }

  async function saveCounselorEmail(rosterId: string) {
    if (isReadOnly) return
    const rosterRow = currentRoster.find((row) => row.id === rosterId)
    if (!rosterRow) return
    const classroomId = classroom.id
    const classroomEpoch = classroomEpochRef.current
    const editEpoch = counselorEditEpochRef.current
    const counselorEmail = editingCounselorValue.trim() || null
    pendingCounselorRosterIdsRef.current = new Set(pendingCounselorRosterIdsRef.current).add(rosterId)
    setPendingCounselorRosterIds(new Set(pendingCounselorRosterIdsRef.current))
    setSavingCounselor({ rosterId, editEpoch })
    setCounselorError(null)

    try {
      const res = await fetch(`/api/teacher/classrooms/${classroomId}/roster/${rosterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          counselor_email: counselorEmail,
          expected_updated_at: rosterRow.updated_at,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (
          res.status === 409
          && currentClassroomIdRef.current === classroomId
          && classroomEpochRef.current === classroomEpoch
          && counselorEditEpochRef.current === editEpoch
        ) {
          invalidateCachedJSON(`teacher-roster:${classroomId}`)
          await loadRoster({ preserveRoster: true })
        }
        throw new Error(data.error || 'Failed to update alt email')
      }
      invalidateCachedJSON(`teacher-roster:${classroomId}`)
      if (
        currentClassroomIdRef.current !== classroomId
        || classroomEpochRef.current !== classroomEpoch
      ) return
      rosterMutationVersionRef.current += 1
      setRoster((prev) =>
        prev.map((r) =>
          r.id === rosterId
            ? {
                ...r,
                counselor_email: counselorEmail,
                updated_at: data.roster?.updated_at ?? r.updated_at,
              }
            : r
        )
      )
      if (counselorEditEpochRef.current === editEpoch) {
        setEditingCounselorId(null)
        setEditingCounselorValue('')
        setCounselorError(null)
        focusCounselorEditButton(rosterId)
      }
    } catch (err: any) {
      if (
        currentClassroomIdRef.current !== classroomId
        || classroomEpochRef.current !== classroomEpoch
        || counselorEditEpochRef.current !== editEpoch
      ) return
      setCounselorError({
        rosterId,
        message: err.message || 'Failed to update alt email',
      })
    } finally {
      if (
        currentClassroomIdRef.current === classroomId
        && classroomEpochRef.current === classroomEpoch
      ) {
        const nextPendingIds = new Set(pendingCounselorRosterIdsRef.current)
        nextPendingIds.delete(rosterId)
        pendingCounselorRosterIdsRef.current = nextPendingIds
        setPendingCounselorRosterIds(nextPendingIds)
      }
      setSavingCounselor((current) => (
        current?.rosterId === rosterId && current.editEpoch === editEpoch ? null : current
      ))
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
    setRemovalError('')
    setPendingRemoval({ rows: rows.map(toRemovalTarget) })
  }

  function refreshRosterAfterMutation(mutatedClassroomId: string) {
    invalidateCachedJSON(`teacher-roster:${mutatedClassroomId}`)
    if (currentClassroomIdRef.current !== mutatedClassroomId) return
    rosterMutationVersionRef.current += 1
    void loadRoster({ preserveRoster: hasCurrentRoster })
  }

  function retryRosterLoad() {
    if (loading) return
    retryFocusIntentRef.current = isRosterUnavailable
    invalidateCachedJSON(`teacher-roster:${classroom.id}`)
    void loadRoster({ preserveRoster: hasCurrentRoster, isRetry: true })
  }

  useEffect(() => {
    if (!loading && hasCurrentRoster && retryFocusIntentRef.current) {
      retryFocusIntentRef.current = false
      rosterRegionRef.current?.focus()
    }
  }, [hasCurrentRoster, loading])

  function getRemovalMenuLabel(rowCount: number) {
    return rowCount > 1 ? 'Remove students' : 'Remove student'
  }

  function formatRemovalTargetName(row: RemovalTarget) {
    return [row.firstName, row.lastName].filter(Boolean).join(' ') || 'Unnamed student'
  }

  function formatRosterRowName(row: RosterRow) {
    return [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email
  }

  function getRemovalDescription(rows: RemovalTarget[]) {
    if (rows.length === 0) return undefined

    if (rows.length === 1) {
      const row = rows[0]
      return `${formatRemovalTargetName(row)}\n${row.email}\n\n${
        row.joined
          ? 'They are currently joined. This removes roster membership, logs, and assignment documents. Use the separate purge action for comprehensive permanent deletion.'
          : 'They are not joined yet.'
      }`
    }

    const previewRows = rows.slice(0, 5)
    const preview = previewRows.map((row) => `${formatRemovalTargetName(row)} - ${row.email}`).join('\n')
    const remaining = rows.length > previewRows.length ? `\n+ ${rows.length - previewRows.length} more` : ''
    const joinedCount = rows.filter((row) => row.joined).length

    return `${preview}${remaining}\n\n${
      joinedCount > 0
        ? `${joinedCount} ${joinedCount === 1 ? 'student is' : 'students are'} currently joined. This removes roster membership, logs, and assignment documents; it is not a comprehensive purge.`
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

  const purgeTarget = removalTargetRows.length === 1
    && removalTargetRows[0].joined
    && removalTargetRows[0].student_id
    && studentPurgeEnabledIds.has(removalTargetRows[0].student_id)
    ? removalTargetRows[0]
    : null

  if (purgeTarget) {
    rosterActionOptions.push({
      id: 'purge-student',
      label: <span className="text-danger">Purge classroom data</span>,
      onSelect: () => setPendingPurge(purgeTarget),
      disabled: isRosterLoading,
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
        label: `Copy alt emails (${selectedCounselorEmails.length})`,
        icon: <Copy className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => copyToClipboard(selectedCounselorEmails, 'Alt emails'),
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
    <TeacherWorkSurfaceContextBar
      ariaLabel="Roster controls"
      primary={
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
            disabled={isRosterLoading || combinedRosterActionOptions.every((option) => option.disabled)}
            menuPlacement="down"
            menuAlign="center"
            menuClassName="w-64"
          />
        </TeacherWorkSurfaceActionCluster>
      }
    />
  )

  const rosterRetryAction = loadError || isRetryingRoster ? (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-label={isRetryingRoster ? 'Retrying roster' : 'Retry loading roster'}
      aria-disabled={isRetryingRoster || undefined}
      className={isRetryingRoster ? 'cursor-not-allowed opacity-50' : undefined}
      onClick={isRetryingRoster ? undefined : retryRosterLoad}
    >
      {isRetryingRoster ? 'Retrying...' : 'Retry'}
    </Button>
  ) : null

  const workspace = isRosterUnavailable ? (
    <PageState
      kind={loading ? 'loading' : 'error'}
      title={loading ? 'Loading roster' : 'Roster unavailable'}
      description={loading ? 'Loading the classroom roster.' : loadError}
      action={rosterRetryAction}
      compact
    />
  ) : (
    <div
      ref={rosterTableScrollRef}
      className="min-h-[200px] flex-1 overflow-auto rounded-lg bg-surface"
      data-testid="roster-student-scroll-pane"
      onScroll={preserveRosterTableScrollPosition}
    >
      <TableCard chrome="flush" overflowX>
        {loadError && (
          <div className="border-b border-border p-3">
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger"
            >
              <span>{loadError}</span>
              {rosterRetryAction}
            </div>
          </div>
        )}
        {counselorError && counselorErrorRow ? (
          <div className="border-b border-border p-3">
            <div
              id={`roster-counselor-error-${counselorError.rosterId}`}
              role="alert"
              className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger"
            >
              Could not save alt email for {formatRosterRowName(counselorErrorRow)}: {counselorError.message}
            </div>
          </div>
        ) : null}

        <KeyboardNavigableTable
          ref={rosterRegionRef}
          ariaLabel="Classroom roster"
          rowKeys={rosterIds}
          selectedKey={selectedRosterId}
          onSelectKey={selectRosterId}
          onDeselect={() => selectRosterId(null)}
          getRowId={getRosterStudentRowId}
        >
          <DataTable density="tight" className="table-fixed">
            <colgroup>
              <col style={{ width: '40px' }} />
              <col style={{ width: `${columnWidths.first}px` }} />
              <col style={{ width: `${columnWidths.last}px` }} />
              <col className="hidden md:table-column" style={{ width: `${columnWidths.email}px` }} />
              <col className="hidden lg:table-column" style={{ width: `${columnWidths.counselor}px` }} />
              <col style={{ width: '88px' }} />
            </colgroup>
            <DataTableHead>
              <DataTableRow>
                <TableSelectionHeaderCell
                  checked={allSelected}
                  indeterminate={selectionIndeterminate}
                  onChange={toggleSelectAll}
                  ariaLabel="Select all students"
                />
                <SortableHeaderCell
                  label="First"
                  isActive={sortColumn === 'first_name'}
                  direction={sortDirection}
                  onClick={() => onSort('first_name')}
                  trailing={sortedRoster.length > 0 ? <StudentCountBadge count={sortedRoster.length} variant="neutral" /> : undefined}
                  buttonClassName="!pr-5"
                  resize={{
                    value: columnWidths.first,
                    min: ROSTER_COLUMN_LIMITS.first.min,
                    max: ROSTER_COLUMN_LIMITS.first.max,
                    onChange: (width) => setColumnWidth('first', width),
                  }}
                />
                <SortableHeaderCell
                  label="Last"
                  isActive={sortColumn === 'last_name'}
                  direction={sortDirection}
                  onClick={() => onSort('last_name')}
                  buttonClassName="!pr-5"
                  resize={{
                    value: columnWidths.last,
                    min: ROSTER_COLUMN_LIMITS.last.min,
                    max: ROSTER_COLUMN_LIMITS.last.max,
                    onChange: (width) => setColumnWidth('last', width),
                  }}
                />
                <SortableHeaderCell
                  label="Email"
                  isActive={sortColumn === 'email'}
                  direction={sortDirection}
                  onClick={() => onSort('email')}
                  className="hidden md:table-cell"
                  buttonClassName="!pr-5"
                  resize={{
                    value: columnWidths.email,
                    min: ROSTER_COLUMN_LIMITS.email.min,
                    max: ROSTER_COLUMN_LIMITS.email.max,
                    onChange: (width) => setColumnWidth('email', width),
                  }}
                />
                <SortableHeaderCell
                  label="Alt email"
                  isActive={sortColumn === 'counselor_email'}
                  direction={sortDirection}
                  onClick={() => onSort('counselor_email')}
                  className="hidden lg:table-cell"
                  buttonClassName="!pr-5"
                  resize={{
                    value: columnWidths.counselor,
                    min: ROSTER_COLUMN_LIMITS.counselor.min,
                    max: ROSTER_COLUMN_LIMITS.counselor.max,
                    onChange: (width) => setColumnWidth('counselor', width),
                  }}
                />
                <SortableHeaderCell
                  label="Joined"
                  isActive={sortColumn === 'joined'}
                  direction={sortDirection}
                  onClick={() => onSort('joined')}
                  align="center"
                  trailing={<CountBadge count={joinedCount} tooltip={`${joinedCount} ${joinedCount === 1 ? 'student' : 'students'} joined`} variant="success" />}
                  trailingPlacement="after-label"
                />
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {sortedRoster.map((row) => {
                const isSelected = row.id === selectedRosterId
                const rowName = formatRosterRowName(row)
                const counselorErrorId = `roster-counselor-error-${row.id}`
                const currentEditEpoch = counselorEditEpochRef.current
                const isSavingCurrentCounselor = savingCounselor?.rosterId === row.id
                  && savingCounselor.editEpoch === currentEditEpoch
                const currentCounselorError = counselorError?.rosterId === row.id
                  ? counselorError.message
                  : null
                const isCounselorSavePending = pendingCounselorRosterIds.has(row.id)
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
                    <TableSelectionCell
                      checked={selectedIds.has(row.id)}
                      onChange={() => toggleSelect(row.id)}
                      ariaLabel={`Select ${row.first_name ?? ''} ${row.last_name ?? ''}`}
                    />
                    <DataTableCell className="truncate" title={row.first_name ?? undefined}>{row.first_name ?? '—'}</DataTableCell>
                    <DataTableCell className="truncate" title={row.last_name ?? undefined}>{row.last_name ?? '—'}</DataTableCell>
                    <DataTableCell className="hidden text-text-muted md:table-cell">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate" title={row.email}>{row.email}</span>
                        <JoinSourceBadge source={row.join_source} />
                      </div>
                    </DataTableCell>
                    <DataTableCell className="hidden text-text-muted lg:table-cell">
                      {editingCounselorId === row.id ? (
                        <div className="flex items-center gap-1">
                          <FormField
                            label={`Alt email for ${rowName}`}
                            hideLabel
                            className="w-32 [&>div:first-child]:sr-only"
                          >
                            <Input
                              type="email"
                              value={editingCounselorValue}
                              onChange={(event) => {
                                if (!isSavingCurrentCounselor) {
                                  setEditingCounselorValue(event.target.value)
                                  setCounselorError(null)
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' && !isSavingCurrentCounselor) {
                                  void saveCounselorEmail(row.id)
                                }
                                if (event.key === 'Escape' && !isSavingCurrentCounselor) {
                                  cancelEditingCounselor(row.id)
                                }
                              }}
                              className="px-2 py-1 text-sm"
                              placeholder="alt@example.com"
                              aria-describedby={currentCounselorError ? counselorErrorId : undefined}
                              aria-invalid={!!currentCounselorError}
                              readOnly={isSavingCurrentCounselor}
                              autoFocus
                            />
                          </FormField>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={isSavingCurrentCounselor ? undefined : () => saveCounselorEmail(row.id)}
                              aria-label={`Save alt email for ${rowName}`}
                              aria-disabled={isSavingCurrentCounselor || undefined}
                              className={`h-8 w-8 p-0 text-success ${
                                isSavingCurrentCounselor ? 'cursor-not-allowed opacity-50' : ''
                              }`}
                            >
                              <Check className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={isSavingCurrentCounselor ? undefined : () => cancelEditingCounselor(row.id)}
                              aria-label={`Cancel alt email for ${rowName}`}
                              aria-disabled={isSavingCurrentCounselor || undefined}
                              className={`h-8 w-8 p-0 text-text-muted ${
                                isSavingCurrentCounselor ? 'cursor-not-allowed opacity-50' : ''
                              }`}
                            >
                              <X className="h-4 w-4" aria-hidden="true" />
                            </Button>
                        </div>
                      ) : (
                        <Button
                          id={getCounselorEditButtonId(row.id)}
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => startEditingCounselor(row)}
                          disabled={isReadOnly || isCounselorSavePending}
                          aria-label={`Edit alt email for ${rowName}`}
                          className={`h-auto min-h-8 max-w-full justify-start gap-1 px-1 py-1 text-left ${
                            isReadOnly || isCounselorSavePending
                              ? 'cursor-not-allowed opacity-50'
                              : 'hover:text-text-default'
                          }`}
                        >
                          {row.counselor_email ? (
                            <span className="truncate max-w-[120px]" title={row.counselor_email}>
                              {row.counselor_email}
                            </span>
                          ) : (
                            <span className="text-text-muted italic">Add</span>
                          )}
                          {!isReadOnly && <Pencil className="h-3 w-3 flex-shrink-0" aria-hidden="true" />}
                        </Button>
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
        errorMessage={removalError || undefined}
        isCancelDisabled={isRemoving}
        isConfirmDisabled={isRemoving}
        onCancel={() => {
          if (isRemoving) return
          setPendingRemoval(null)
          setRemovalError('')
        }}
        onConfirm={confirmRemoveStudent}
      />

      {pendingPurge?.student_id ? (
        <StudentPurgeDialog
          classroomId={classroom.id}
          classroomTitle={classroom.title}
          studentId={pendingPurge.student_id}
          studentEmail={pendingPurge.email}
          studentName={[pendingPurge.first_name, pendingPurge.last_name].filter(Boolean).join(' ') || 'Unnamed student'}
          isOpen
          onClose={() => setPendingPurge(null)}
          onCompleted={() => {
            setPendingPurge(null)
            refreshRosterAfterMutation(classroom.id)
          }}
        />
      ) : null}
    </>
  )
}
