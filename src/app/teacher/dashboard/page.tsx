'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Plus, RotateCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  AlertDialog,
  Button,
  IconButton,
  ContentDialog,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  PageState,
  SortableHeaderCell,
  TableCard,
} from '@/ui'
import { Spinner } from '@/components/Spinner'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import { UploadRosterModal } from '@/components/UploadRosterModal'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import type { Classroom, AttendanceRecord, Entry } from '@/types'
import { getAttendanceIcon } from '@/lib/attendance'
import { PageActionBar, PageContent, PageLayout, type ActionBarItem } from '@/components/PageLayout'
import {
  fetchTeacherDashboardAttendance,
  fetchTeacherDashboardEntry,
  invalidateTeacherDashboardAttendance,
} from '@/lib/teacher-dashboard-client'
import { fetchTeacherClassrooms, invalidateTeacherClassrooms } from '@/lib/teacher-classrooms-client'
import { applyDirection, toggleSort } from '@/lib/table-sort'
import { useTableColumnWidths } from '@/hooks/useTableColumnWidths'

type AttendanceSortColumn = 'student' | 'present' | 'absent'

type EntryDetailTarget = {
  classroomId: string
  studentId: string
  studentEmail: string
  date: string
}

type EntryDetailState =
  | { status: 'closed' }
  | { status: 'loading'; target: EntryDetailTarget; isRetry: boolean }
  | { status: 'ready'; target: EntryDetailTarget; entry: Entry }
  | { status: 'empty'; target: EntryDetailTarget }
  | { status: 'error'; target: EntryDetailTarget }

const DASHBOARD_ATTENDANCE_COLUMN_LIMITS = {
  student: { defaultWidth: 220, min: 140, max: 360 },
}

export default function TeacherDashboardPage() {
  const router = useRouter()
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [selectedClassroom, setSelectedClassroom] = useState<Classroom | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [dates, setDates] = useState<string[]>([])
  const [attendanceClassroomId, setAttendanceClassroomId] = useState<string | null>(null)
  const [loadingAttendance, setLoadingAttendance] = useState(false)
  const [attendanceError, setAttendanceError] = useState('')
  const [attendanceAttempt, setAttendanceAttempt] = useState(0)
  const [entryDetail, setEntryDetail] = useState<EntryDetailState>({ status: 'closed' })
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [{ column: attendanceSortColumn, direction: attendanceSortDirection }, setAttendanceSort] = useState<{
    column: AttendanceSortColumn
    direction: 'asc' | 'desc'
  }>({ column: 'student', direction: 'asc' })
  const { columnWidths: attendanceColumnWidths, setColumnWidth: setAttendanceColumnWidth } = useTableColumnWidths({
    storageKey: 'teacher-dashboard-attendance:v1',
    columns: DASHBOARD_ATTENDANCE_COLUMN_LIMITS,
  })
  const attendanceRequestIdRef = useRef(0)
  const entryRequestIdRef = useRef(0)
  const pageRegionRef = useRef<HTMLDivElement>(null)
  const selectedClassroomIdRef = useRef<string | null>(null)
  selectedClassroomIdRef.current = selectedClassroom?.id ?? null

  const { alertState, showSuccess, closeAlert } = useAlertDialog()

  const sortedAttendance = useMemo(() => {
    const rows = [...attendance]
    rows.sort((left, right) => {
      let comparison = 0
      if (attendanceSortColumn === 'student') {
        comparison = left.student_email.localeCompare(right.student_email)
      } else {
        comparison = left.summary[attendanceSortColumn] - right.summary[attendanceSortColumn]
      }
      if (comparison !== 0) return applyDirection(comparison, attendanceSortDirection)
      return left.student_email.localeCompare(right.student_email)
    })
    return rows
  }, [attendance, attendanceSortColumn, attendanceSortDirection])

  function handleAttendanceSort(column: AttendanceSortColumn) {
    setAttendanceSort((current) => toggleSort(current, column))
  }

  const loadClassrooms = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const nextClassrooms = await fetchTeacherClassrooms()
      setClassrooms(nextClassrooms)
      setSelectedClassroom(nextClassrooms[0] ?? null)
    } catch (err) {
      console.error('Error loading classrooms:', err)
      setLoadError(err instanceof Error ? err.message : 'Failed to load classrooms')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadClassrooms()
  }, [loadClassrooms])

  // Load attendance when classroom selected
  useEffect(() => {
    if (!selectedClassroom) {
      attendanceRequestIdRef.current += 1
      entryRequestIdRef.current += 1
      setAttendance([])
      setDates([])
      setAttendanceClassroomId(null)
      setAttendanceError('')
      setEntryDetail({ status: 'closed' })
      return
    }

    entryRequestIdRef.current += 1
    setEntryDetail({ status: 'closed' })

    async function loadAttendance() {
      if (!selectedClassroom) return
      const classroomId = selectedClassroom.id
      const requestId = attendanceRequestIdRef.current + 1
      attendanceRequestIdRef.current = requestId

      setLoadingAttendance(true)
      setAttendanceError('')
      try {
        const data = await fetchTeacherDashboardAttendance(classroomId)

        if (attendanceRequestIdRef.current !== requestId || selectedClassroomIdRef.current !== classroomId) return
        setAttendance(data.attendance || [])
        setDates(data.dates || [])
        setAttendanceClassroomId(classroomId)
      } catch (err) {
        if (attendanceRequestIdRef.current !== requestId || selectedClassroomIdRef.current !== classroomId) return
        console.error('Error loading attendance:', err)
        setAttendance([])
        setDates([])
        setAttendanceClassroomId(classroomId)
        setAttendanceError('The attendance overview could not be retrieved.')
      } finally {
        if (attendanceRequestIdRef.current !== requestId || selectedClassroomIdRef.current !== classroomId) return
        setLoadingAttendance(false)
      }
    }

    loadAttendance()
  }, [attendanceAttempt, selectedClassroom])

  async function loadEntryDetail(target: EntryDetailTarget, isRetry = false) {
    const requestId = entryRequestIdRef.current + 1
    entryRequestIdRef.current = requestId

    setEntryDetail({ status: 'loading', target, isRetry })

    try {
      const entry = await fetchTeacherDashboardEntry(target.classroomId, target.studentId, target.date)

      if (
        entryRequestIdRef.current !== requestId
        || selectedClassroomIdRef.current !== target.classroomId
      ) {
        return
      }

      setEntryDetail(entry
        ? { status: 'ready', target, entry }
        : { status: 'empty', target })
    } catch (err) {
      if (
        entryRequestIdRef.current !== requestId
        || selectedClassroomIdRef.current !== target.classroomId
      ) {
        return
      }
      console.error('Error loading entry:', err)
      setEntryDetail({ status: 'error', target })
    }
  }

  function handleCellClick(studentId: string, studentEmail: string, date: string) {
    if (!selectedClassroom) return
    void loadEntryDetail({
      classroomId: selectedClassroom.id,
      studentId,
      studentEmail,
      date,
    })
  }

  function closeEntryDetail() {
    entryRequestIdRef.current += 1
    setEntryDetail({ status: 'closed' })
  }

  function retryEntryDetail() {
    if (entryDetail.status === 'closed') return
    void loadEntryDetail(entryDetail.target, true)
  }

  async function handleExportCSV() {
    if (!selectedClassroom) return
    window.location.href = `/api/teacher/export-csv?classroom_id=${selectedClassroom.id}`
  }

  function handleClassroomCreated(classroom: Classroom) {
    invalidateTeacherClassrooms()
    invalidateTeacherDashboardAttendance(classroom.id)
    setClassrooms((current) => [classroom, ...current.filter((item) => item.id !== classroom.id)])
    setSelectedClassroom(classroom)
  }

  function handleCopyJoinLink() {
    if (!selectedClassroom) return
    const link = `${window.location.origin}/join/${selectedClassroom.id}`
    navigator.clipboard.writeText(link)
    showSuccess('Link Copied', 'Join link copied to clipboard!')
  }

  function handleCopyClassCode() {
    if (!selectedClassroom) return
    navigator.clipboard.writeText(selectedClassroom.class_code)
    showSuccess('Code Copied', 'Class code copied to clipboard!')
  }

  if (loading) {
    return (
      <div
        ref={pageRegionRef}
        role="region"
        aria-label="Teacher dashboard"
        tabIndex={-1}
        className="focus:outline-none"
      >
        <PageLayout density="teacher" width="reading">
          <PageContent>
            <PageState
              kind="loading"
              headingLevel="h1"
              title="Loading classrooms"
              description="Getting the latest classroom overview."
            />
          </PageContent>
        </PageLayout>
      </div>
    )
  }

  if (loadError) {
    return (
      <div
        ref={pageRegionRef}
        role="region"
        aria-label="Teacher dashboard"
        tabIndex={-1}
        className="focus:outline-none"
      >
        <PageLayout density="teacher" width="reading">
          <PageContent>
            <PageState
              kind="error"
              headingLevel="h1"
              title="Could not load classrooms"
              description="The dashboard could not retrieve your classrooms."
              action={
                <IconButton
                  icon={RotateCw}
                  label="Try again"
                  onClick={() => {
                    pageRegionRef.current?.focus()
                    invalidateTeacherClassrooms()
                    void loadClassrooms()
                  }}
                />
              }
            />
          </PageContent>
        </PageLayout>
      </div>
    )
  }

  // Empty state
  if (classrooms.length === 0) {
    return (
      <>
        <div
          ref={pageRegionRef}
          role="region"
          aria-label="Teacher dashboard"
          tabIndex={-1}
          className="focus:outline-none"
        >
          <PageLayout density="teacher" width="reading">
            <PageContent>
              <PageState
                kind="empty"
                headingLevel="h1"
                title="No Classrooms Yet"
                description="Create your first classroom or start from a course blueprint."
                action={
                  <div className="flex flex-wrap justify-center gap-3">
                    <IconButton icon={Plus} label="Create classroom" onClick={() => setShowCreateModal(true)} />
                    <Button variant="secondary" onClick={() => router.push('/teacher/blueprints')}>
                      Course Blueprints
                    </Button>
                  </div>
                }
              />
            </PageContent>
          </PageLayout>
        </div>

        <CreateClassroomModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleClassroomCreated}
          onBlueprintCreated={handleClassroomCreated}
        />
      </>
    )
  }

  return (
    <>
      <div
        ref={pageRegionRef}
        role="region"
        aria-label="Teacher dashboard"
        tabIndex={-1}
        className="flex flex-col gap-4 focus:outline-none md:flex-row md:gap-6"
      >
      {/* Classroom List Sidebar */}
      <div className="w-full flex-shrink-0 md:w-64">
        <div className="bg-surface rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-text-default">Classes</h3>
            <button
              onClick={() => setShowCreateModal(true)}
              className="text-primary hover:text-primary-hover text-sm font-medium"
            >
              + New
            </button>
          </div>

          <div className="space-y-2">
            {classrooms.map((classroom) => (
              <div
                key={classroom.id}
                className={`p-3 rounded transition border ${
                  selectedClassroom?.id === classroom.id
                    ? 'bg-info-bg border-primary'
                    : 'hover:bg-surface-hover border-transparent'
                }`}
              >
                <button
                  onClick={() => setSelectedClassroom(classroom)}
                  className="w-full text-left"
                >
                  <div className="font-medium text-text-default text-sm">
                    {classroom.title}
                  </div>
                  <div className="text-xs text-text-muted mt-1">
                    {classroom.class_code}
                  </div>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="min-w-0 flex-1">
        {selectedClassroom ? (
          <PageLayout>
            <PageActionBar
              primary={
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-default truncate">
                    {selectedClassroom.title}
                  </div>
                  <div className="text-xs text-text-muted truncate">
                    <span className="font-mono">{selectedClassroom.class_code}</span>
                    {selectedClassroom.term_label ? ` • ${selectedClassroom.term_label}` : ''}
                  </div>
                </div>
              }
              actions={
                [
                  {
                    id: 'course-blueprints',
                    label: 'Course blueprints',
                    onSelect: () => router.push('/teacher/blueprints'),
                  },
                  {
                    id: 'open-classroom',
                    label: 'Open classroom',
                    onSelect: () => router.push(`/classrooms/${selectedClassroom.id}`),
                  },
                  {
                    id: 'copy-code',
                    label: 'Copy code',
                    onSelect: handleCopyClassCode,
                  },
                  {
                    id: 'copy-link',
                    label: 'Copy link',
                    onSelect: handleCopyJoinLink,
                  },
                  {
                    id: 'upload-roster',
                    label: 'Upload roster',
                    onSelect: () => setShowUploadModal(true),
                  },
                  {
                    id: 'export-csv',
                    label: 'Export CSV',
                    onSelect: handleExportCSV,
                  },
                ] satisfies ActionBarItem[]
              }
            />

            <PageContent>
              {/* Attendance Dashboard */}
              {loadingAttendance || attendanceClassroomId !== selectedClassroom.id ? (
                <div className="flex justify-center py-12">
                  <Spinner size="lg" />
                </div>
              ) : attendanceError ? (
                <PageState
                  kind="error"
                  compact
                  title="Could not load attendance"
                  description={attendanceError}
                  action={
                    <Button
                      type="button"
                      onClick={() => {
                        pageRegionRef.current?.focus()
                        invalidateTeacherDashboardAttendance(selectedClassroom.id)
                        setAttendanceClassroomId(null)
                        setAttendanceAttempt((attempt) => attempt + 1)
                      }}
                    >
                      Try again
                    </Button>
                  }
                />
              ) : attendance.length === 0 ? (
                <div className="bg-surface rounded-lg shadow-sm p-8 text-center text-text-muted">
                  No students enrolled yet
                </div>
              ) : (
                <div className="shadow-sm">
                  <TableCard overflowX>
                    <DataTable className="min-w-max">
                      <DataTableHead>
                        <DataTableRow>
                          <SortableHeaderCell
                            label="Student"
                            isActive={attendanceSortColumn === 'student'}
                            direction={attendanceSortDirection}
                            onClick={() => handleAttendanceSort('student')}
                            className="sticky left-0 z-10 bg-surface-2"
                            resize={{
                              value: attendanceColumnWidths.student,
                              min: DASHBOARD_ATTENDANCE_COLUMN_LIMITS.student.min,
                              max: DASHBOARD_ATTENDANCE_COLUMN_LIMITS.student.max,
                              onChange: (width) => setAttendanceColumnWidth('student', width),
                            }}
                          />
                          <SortableHeaderCell
                            label="Present"
                            isActive={attendanceSortColumn === 'present'}
                            direction={attendanceSortDirection}
                            onClick={() => handleAttendanceSort('present')}
                            align="center"
                          />
                          <SortableHeaderCell
                            label="Absent"
                            isActive={attendanceSortColumn === 'absent'}
                            direction={attendanceSortDirection}
                            onClick={() => handleAttendanceSort('absent')}
                            align="center"
                          />
                          {dates.map(date => (
                            <DataTableHeaderCell
                              key={date}
                              align="center"
                              className="whitespace-nowrap text-xs uppercase tracking-wider"
                            >
                              {date.slice(5)}
                            </DataTableHeaderCell>
                          ))}
                        </DataTableRow>
                      </DataTableHead>
                      <DataTableBody>
                        {sortedAttendance.map(record => (
                          <DataTableRow key={record.student_id} className="group hover:bg-surface-hover">
                            <DataTableCell
                              className="sticky left-0 z-10 whitespace-nowrap bg-surface font-medium group-hover:bg-surface-hover"
                              style={{
                                width: `${attendanceColumnWidths.student}px`,
                                minWidth: `${attendanceColumnWidths.student}px`,
                                maxWidth: `${attendanceColumnWidths.student}px`,
                              }}
                            >
                              <span className="block truncate" title={record.student_email}>{record.student_email}</span>
                            </DataTableCell>
                            <DataTableCell align="center" className="whitespace-nowrap">
                              {record.summary.present}
                            </DataTableCell>
                            <DataTableCell align="center" className="whitespace-nowrap">
                              {record.summary.absent}
                            </DataTableCell>
                            {dates.map(date => {
                              const status = record.dates[date]
                              const hasEntry = status === 'present'

                              return (
                                <DataTableCell
                                  key={date}
                                  align="center"
                                  className="whitespace-nowrap text-xl"
                                >
                                  {hasEntry ? (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="text-xl"
                                      aria-label={`Open ${record.student_email} log for ${date}`}
                                      onClick={() => handleCellClick(record.student_id, record.student_email, date)}
                                    >
                                      <span aria-hidden="true">{getAttendanceIcon(status)}</span>
                                    </Button>
                                  ) : status ? (
                                    <span aria-label={`${record.student_email} ${status} on ${date}`}>
                                      {getAttendanceIcon(status)}
                                    </span>
                                  ) : null}
                                </DataTableCell>
                              )
                            })}
                          </DataTableRow>
                        ))}
                      </DataTableBody>
                    </DataTable>
                  </TableCard>
                </div>
              )}

              <ContentDialog
                isOpen={entryDetail.status !== 'closed'}
                onClose={closeEntryDetail}
                title={entryDetail.status === 'closed' ? 'Student log' : entryDetail.target.studentEmail}
                subtitle={entryDetail.status === 'closed' ? undefined : entryDetail.target.date}
                maxWidth="!max-w-2xl"
                showFooterClose={false}
              >
                {(entryDetail.status === 'loading' || entryDetail.status === 'error') && (
                  <PageState
                    kind={entryDetail.status === 'loading' ? 'loading' : 'error'}
                    headingLevel="h3"
                    title={entryDetail.status === 'loading' ? 'Loading log' : 'Could not load log'}
                    description={entryDetail.status === 'loading'
                      ? 'Getting the latest student entry.'
                      : 'The student entry could not be retrieved.'}
                    action={(entryDetail.status === 'error' || entryDetail.isRetry) ? (
                      <Button
                        aria-disabled={entryDetail.status === 'loading'}
                        className={entryDetail.status === 'loading' ? 'cursor-not-allowed opacity-50' : undefined}
                        onClick={entryDetail.status === 'error' ? retryEntryDetail : undefined}
                      >
                        {entryDetail.status === 'loading' ? 'Trying again' : 'Try again'}
                      </Button>
                    ) : undefined}
                  />
                )}

                {entryDetail.status === 'empty' && (
                  <PageState
                    kind="empty"
                    headingLevel="h3"
                    title="No log found"
                    description="There is no student entry for this date."
                  />
                )}

                {entryDetail.status === 'ready' && (
                  <div className="space-y-4">
                    <div>
                      <div className="mb-1 text-sm font-medium text-text-muted">Entry</div>
                      <p className="whitespace-pre-wrap text-text-default">{entryDetail.entry.text}</p>
                    </div>

                    {entryDetail.entry.minutes_reported != null && (
                      <div>
                        <div className="mb-1 text-sm font-medium text-text-muted">Time Spent</div>
                        <p className="text-text-default">{entryDetail.entry.minutes_reported} minutes</p>
                      </div>
                    )}

                    {entryDetail.entry.mood && (
                      <div>
                        <div className="mb-1 text-sm font-medium text-text-muted">Mood</div>
                        <p className="text-2xl">{entryDetail.entry.mood}</p>
                      </div>
                    )}
                  </div>
                )}
              </ContentDialog>
            </PageContent>
          </PageLayout>
        ) : (
          <div className="bg-surface rounded-lg shadow-sm p-8 text-center text-text-muted">
            Select a classroom to view attendance
          </div>
        )}
      </div>

        {selectedClassroom && (
          <UploadRosterModal
            isOpen={showUploadModal}
            onClose={() => setShowUploadModal(false)}
            classroomId={selectedClassroom.id}
            onSuccess={() => {
              invalidateTeacherDashboardAttendance(selectedClassroom.id)
              setAttendanceClassroomId(null)
              setAttendanceAttempt((attempt) => attempt + 1)
            }}
          />
        )}

        <AlertDialog {...alertState} onClose={closeAlert} />
      </div>

      <CreateClassroomModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleClassroomCreated}
        onBlueprintCreated={handleClassroomCreated}
      />
    </>
  )
}
