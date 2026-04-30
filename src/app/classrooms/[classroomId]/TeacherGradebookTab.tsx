'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  Classroom,
  GradebookClassSummary,
  GradebookStudentDetail,
  GradebookStudentSummary,
} from '@/types'
import { Button, FormField, Input } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { SummaryDetailWorkspaceShell } from '@/components/SummaryDetailWorkspaceShell'
import { TeacherWorkSurfaceModeBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceModeBar'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyStateRow,
  KeyboardNavigableTable,
  TableCard,
} from '@/components/DataTable'
import {
  fetchJSONWithCache,
  invalidateCachedJSONMatching,
} from '@/lib/request-cache'

type GradebookSection = 'grades' | 'settings'

interface GradebookSettingsState {
  use_weights: boolean
  assignments_weight: number
  quizzes_weight: number
  tests_weight: number
}

interface GradebookPayload {
  settings: GradebookSettingsState
  students: GradebookStudentSummary[]
  selected_student?: GradebookStudentDetail | null
  class_summary?: GradebookClassSummary | null
}

interface Props {
  classroom: Classroom
  sectionParam?: string | null
  onSectionChange?: (section: GradebookSection) => void
}

const DEFAULT_SETTINGS: GradebookSettingsState = {
  use_weights: false,
  assignments_weight: 50,
  quizzes_weight: 20,
  tests_weight: 30,
}

function formatPercent(value: number | null): string {
  if (value == null) return '—'
  return `${value.toFixed(1)}%`
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatTorontoDateShort(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      month: 'short',
      day: 'numeric',
      timeZone: 'America/Toronto',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function getStudentName(student: GradebookStudentSummary): string {
  return `${student.student_first_name || ''} ${student.student_last_name || ''}`.trim() || student.student_email
}

function getSettingsWithDefaults(settings: Partial<GradebookSettingsState> | null | undefined): GradebookSettingsState {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    tests_weight: Number(settings?.tests_weight ?? DEFAULT_SETTINGS.tests_weight),
  }
}

function CategoryHeading({ children }: { children: string }) {
  return <h3 className="text-sm font-semibold text-text-default">{children}</h3>
}

function ClassSummaryPanel({ summary }: { summary: GradebookClassSummary | null }) {
  return (
    <div className="space-y-4 p-4">
      <div className="rounded-md border border-border bg-surface-2 p-3">
        <div className="text-xs text-text-muted">Class average</div>
        <div className="mt-1 text-lg font-semibold text-text-default">
          {formatPercent(summary?.average_final_percent ?? null)}
        </div>
      </div>

      <div>
        <CategoryHeading>Assignments</CategoryHeading>
        {summary?.assignments?.length ? (
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              <div />
              <div className="text-right">Avg</div>
              <div className="text-right">Med</div>
              <div className="text-right">#</div>
            </div>
            {summary.assignments.map((item) => (
              <div
                key={item.assignment_id}
                className={[
                  'rounded-md border px-3 py-2',
                  item.is_draft ? 'border-border-strong bg-surface-2' : 'border-border bg-surface',
                ].join(' ')}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-text-default">{item.title}</div>
                    <div className="text-xs text-text-muted">
                      {`Due ${formatTorontoDateShort(item.due_at)}${item.is_draft ? ' . Draft' : ''}`}
                    </div>
                  </div>
                  <div className="text-right text-sm font-semibold tabular-nums text-text-default">
                    {item.average_percent != null ? item.average_percent.toFixed(1) : '—'}
                  </div>
                  <div className="text-right text-sm font-semibold tabular-nums text-text-default">
                    {item.median_percent != null ? item.median_percent.toFixed(1) : '—'}
                  </div>
                  <div className="text-right text-sm font-semibold tabular-nums text-text-default">
                    {item.graded_count}/{summary.total_students}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-text-muted">No assignments yet.</p>
        )}
      </div>

      <ClassAssessmentSummarySection
        title="Quizzes"
        emptyMessage="No quizzes yet."
        totalStudents={summary?.total_students ?? 0}
        items={(summary?.quizzes || []).map((item) => ({
          id: item.quiz_id,
          title: item.title,
          status: item.status,
          scored_count: item.scored_count,
          average_percent: item.average_percent,
        }))}
      />

      <ClassAssessmentSummarySection
        title="Tests"
        emptyMessage="No tests yet."
        totalStudents={summary?.total_students ?? 0}
        items={(summary?.tests || []).map((item) => ({
          id: item.test_id,
          title: item.title,
          status: item.status,
          scored_count: item.scored_count,
          average_percent: item.average_percent,
        }))}
      />
    </div>
  )
}

function ClassAssessmentSummarySection({
  title,
  emptyMessage,
  totalStudents,
  items,
}: {
  title: string
  emptyMessage: string
  totalStudents: number
  items: Array<{
    id: string
    title: string
    status: 'draft' | 'active' | 'closed' | null
    scored_count: number
    average_percent: number | null
  }>
}) {
  return (
    <div>
      <CategoryHeading>{title}</CategoryHeading>
      {items.length ? (
        <div className="mt-2 space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-md border border-border px-3 py-2">
              <div className="text-sm text-text-default">{item.title}</div>
              <div className="text-xs text-text-muted">
                {item.status || 'unknown'} . {item.average_percent != null
                  ? `Avg ${formatPercent(item.average_percent)} . Scored ${item.scored_count}/${totalStudents}`
                  : `No scored responses . Scored ${item.scored_count}/${totalStudents}`}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-text-muted">{emptyMessage}</p>
      )}
    </div>
  )
}

function StudentDetailPanel({
  detail,
  loading,
  error,
}: {
  detail: GradebookStudentDetail | null
  loading: boolean
  error: string
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      {error && (
        <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="rounded-md border border-border bg-surface-2 p-3">
        <div className="text-xs text-text-muted">Overall</div>
        <div className="mt-1 text-lg font-semibold text-text-default">
          {formatPercent(detail?.final_percent ?? null)}
        </div>
      </div>

      <div>
        <CategoryHeading>Assignments</CategoryHeading>
        {detail?.assignments?.length ? (
          <div className="mt-2 space-y-2">
            {detail.assignments.map((item) => (
              <div
                key={item.assignment_id}
                className={[
                  'rounded-md border px-3 py-2',
                  item.is_draft ? 'border-border-strong bg-surface-2' : 'border-border bg-surface',
                ].join(' ')}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-text-default">{item.title}</div>
                    <div className="text-xs text-text-muted">
                      {`Due ${formatTorontoDateShort(item.due_at)}${item.is_draft ? ' . Draft' : ''}`}
                      {!item.is_graded ? ` . No grade (${formatPoints(item.possible)} pts)` : ''}
                    </div>
                  </div>
                  <div className="text-right text-sm font-semibold tabular-nums text-text-default">
                    {item.is_graded && item.earned != null
                      ? `${formatPoints(item.earned)}/${formatPoints(item.possible)}`
                      : '—'}
                  </div>
                  <div className="text-right text-sm font-semibold tabular-nums text-text-default">
                    {item.is_graded && item.percent != null ? `${item.percent.toFixed(1)}%` : '—'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-text-muted">No assignments yet.</p>
        )}
      </div>

      <StudentAssessmentDetailSection
        title="Quizzes"
        emptyMessage="No scored quizzes yet."
        items={(detail?.quizzes || []).map((item) => ({
          id: item.quiz_id,
          title: item.title,
          earned: item.earned,
          possible: item.possible,
          percent: item.percent,
          meta: item.is_manual_override ? 'Manual override' : null,
        }))}
      />

      <StudentAssessmentDetailSection
        title="Tests"
        emptyMessage="No scored tests yet."
        items={(detail?.tests || []).map((item) => ({
          id: item.test_id,
          title: item.title,
          earned: item.earned,
          possible: item.possible,
          percent: item.percent,
          meta: item.status || null,
        }))}
      />
    </div>
  )
}

function StudentAssessmentDetailSection({
  title,
  emptyMessage,
  items,
}: {
  title: string
  emptyMessage: string
  items: Array<{
    id: string
    title: string
    earned: number
    possible: number
    percent: number
    meta: string | null
  }>
}) {
  return (
    <div>
      <CategoryHeading>{title}</CategoryHeading>
      {items.length ? (
        <div className="mt-2 space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-md border border-border px-3 py-2">
              <div className="text-sm text-text-default">{item.title}</div>
              <div className="text-xs text-text-muted">
                <span className="font-semibold text-text-default">
                  {formatPoints(item.earned)}/{formatPoints(item.possible)}
                </span>
                {' . '}
                <span className="font-semibold text-text-default">{formatPercent(item.percent)}</span>
                {item.meta ? ` . ${item.meta}` : ''}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-text-muted">{emptyMessage}</p>
      )}
    </div>
  )
}

export function TeacherGradebookTab({
  classroom,
  sectionParam,
  onSectionChange = () => {},
}: Props) {
  const section: GradebookSection = sectionParam === 'settings' ? 'settings' : 'grades'
  const isReadOnly = !!classroom.archived_at
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<GradebookSettingsState>(DEFAULT_SETTINGS)
  const [students, setStudents] = useState<GradebookStudentSummary[]>([])
  const [classSummary, setClassSummary] = useState<GradebookClassSummary | null>(null)
  const [selectedStudent, setSelectedStudent] = useState<GradebookStudentSummary | null>(null)
  const [studentDetail, setStudentDetail] = useState<GradebookStudentDetail | null>(null)
  const [studentDetailLoading, setStudentDetailLoading] = useState(false)
  const [studentDetailError, setStudentDetailError] = useState('')

  const rowKeys = useMemo(() => students.map((student) => student.student_id), [students])

  const loadGradebook = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchJSONWithCache<GradebookPayload>(
        `gradebook:${classroom.id}:class`,
        async () => {
          const response = await fetch(`/api/teacher/gradebook?classroom_id=${classroom.id}`)
          const json = await response.json()
          if (!response.ok) throw new Error(json.error || 'Failed to load gradebook')
          return json
        },
        60_000,
      )

      setSettings(getSettingsWithDefaults(data.settings))
      setStudents(data.students || [])
      setClassSummary(data.class_summary || null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load gradebook')
      setClassSummary(null)
    } finally {
      setLoading(false)
    }
  }, [classroom.id])

  useEffect(() => {
    void loadGradebook()
  }, [loadGradebook])

  useEffect(() => {
    if (section !== 'grades' || !selectedStudent) return
    const selectedStudentId = selectedStudent.student_id
    let cancelled = false

    async function loadStudentDetail() {
      setStudentDetailLoading(true)
      setStudentDetailError('')
      try {
        const data = await fetchJSONWithCache<GradebookPayload>(
          `gradebook:${classroom.id}:student:${selectedStudentId}`,
          async () => {
            const response = await fetch(
              `/api/teacher/gradebook?classroom_id=${classroom.id}&student_id=${selectedStudentId}`
            )
            const json = await response.json()
            if (!response.ok) throw new Error(json.error || 'Failed to load gradebook details')
            return json
          },
          60_000,
        )

        if (!cancelled) {
          setStudentDetail(data.selected_student || null)
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setStudentDetail(null)
          setStudentDetailError(err instanceof Error ? err.message : 'Failed to load gradebook details')
        }
      } finally {
        if (!cancelled) {
          setStudentDetailLoading(false)
        }
      }
    }

    void loadStudentDetail()
    return () => {
      cancelled = true
    }
  }, [classroom.id, section, selectedStudent])

  async function saveSettings() {
    if (isReadOnly) return

    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/teacher/gradebook', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroom_id: classroom.id,
          use_weights: settings.use_weights,
          assignments_weight: settings.assignments_weight,
          quizzes_weight: settings.quizzes_weight,
          tests_weight: settings.tests_weight,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save settings')
      }

      setSettings(getSettingsWithDefaults(data.settings))
      invalidateCachedJSONMatching(`gradebook:${classroom.id}:`)
      await loadGradebook()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const totalWeight = useMemo(
    () =>
      Number(settings.assignments_weight || 0) +
      Number(settings.quizzes_weight || 0) +
      Number(settings.tests_weight || 0),
    [settings.assignments_weight, settings.quizzes_weight, settings.tests_weight],
  )

  const gradesWorkspace = loading ? (
    <div className="flex flex-1 justify-center py-12">
      <Spinner size="lg" />
    </div>
  ) : (
    <SummaryDetailWorkspaceShell
      className="flex-1"
      orientation="responsive"
      leftPaneClassName="flex min-h-0 flex-col lg:basis-1/2"
      rightPaneClassName="flex min-h-0 flex-col lg:basis-1/2"
      left={
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <TableCard>
            <KeyboardNavigableTable
              rowKeys={rowKeys}
              selectedKey={selectedStudent?.student_id ?? null}
              onSelectKey={(studentId) => {
                const student = students.find((row) => row.student_id === studentId) || null
                setSelectedStudent(student)
              }}
              onDeselect={() => setSelectedStudent(null)}
            >
              <DataTable density="tight">
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell className="text-xs sm:text-sm">Student</DataTableHeaderCell>
                    <DataTableHeaderCell align="right" className="text-xs sm:text-sm" aria-label="Assignments">
                      <span className="hidden sm:inline">Assignments</span>
                      <span className="sm:hidden">Assign.</span>
                    </DataTableHeaderCell>
                    <DataTableHeaderCell align="right" className="text-xs sm:text-sm" aria-label="Quizzes">
                      <span className="hidden sm:inline">Quizzes</span>
                      <span className="sm:hidden">Quiz</span>
                    </DataTableHeaderCell>
                    <DataTableHeaderCell align="right" className="text-xs sm:text-sm" aria-label="Tests">
                      <span className="hidden sm:inline">Tests</span>
                      <span className="sm:hidden">Test</span>
                    </DataTableHeaderCell>
                    <DataTableHeaderCell align="right" className="text-xs sm:text-sm">Final</DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {students.map((student) => {
                    const isSelected = student.student_id === selectedStudent?.student_id
                    return (
                      <DataTableRow
                        key={student.student_id}
                        className={[
                          'cursor-pointer transition-colors',
                          isSelected ? 'bg-surface-selected hover:bg-surface-selected' : 'hover:bg-surface-hover',
                        ].join(' ')}
                        onClick={() => setSelectedStudent(isSelected ? null : student)}
                      >
                        <DataTableCell className="max-w-[7rem] text-xs sm:max-w-none sm:text-sm">
                          {getStudentName(student)}
                        </DataTableCell>
                        <DataTableCell align="right" className="whitespace-nowrap text-xs sm:text-sm">
                          {formatPercent(student.assignments_percent)}
                        </DataTableCell>
                        <DataTableCell align="right" className="whitespace-nowrap text-xs sm:text-sm">
                          {formatPercent(student.quizzes_percent)}
                        </DataTableCell>
                        <DataTableCell align="right" className="whitespace-nowrap text-xs sm:text-sm">
                          {formatPercent(student.tests_percent)}
                        </DataTableCell>
                        <DataTableCell align="right" className="whitespace-nowrap text-xs font-semibold sm:text-sm">
                          {formatPercent(student.final_percent)}
                        </DataTableCell>
                      </DataTableRow>
                    )
                  })}

                  {students.length === 0 && (
                    <EmptyStateRow colSpan={5} message="No students enrolled yet" />
                  )}
                </DataTableBody>
              </DataTable>
            </KeyboardNavigableTable>
          </TableCard>
        </div>
      }
      right={
        <div className="min-h-0 flex-1 overflow-y-auto">
          {selectedStudent ? (
            <StudentDetailPanel
              detail={studentDetail}
              loading={studentDetailLoading}
              error={studentDetailError}
            />
          ) : (
            <ClassSummaryPanel summary={classSummary} />
          )}
        </div>
      }
    />
  )

  const settingsWorkspace = (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="max-w-2xl space-y-5">
        <label className="inline-flex items-center gap-2 text-sm text-text-default">
          <input
            type="checkbox"
            checked={settings.use_weights}
            onChange={(event) => setSettings((previous) => ({ ...previous, use_weights: event.target.checked }))}
            disabled={isReadOnly}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          Use category weights
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Assignments">
            <Input
              type="number"
              min={0}
              max={100}
              value={settings.assignments_weight}
              onChange={(event) =>
                setSettings((previous) => ({ ...previous, assignments_weight: Number(event.target.value || 0) }))
              }
              disabled={isReadOnly}
            />
          </FormField>
          <FormField label="Quizzes">
            <Input
              type="number"
              min={0}
              max={100}
              value={settings.quizzes_weight}
              onChange={(event) =>
                setSettings((previous) => ({ ...previous, quizzes_weight: Number(event.target.value || 0) }))
              }
              disabled={isReadOnly}
            />
          </FormField>
          <FormField label="Tests">
            <Input
              type="number"
              min={0}
              max={100}
              value={settings.tests_weight}
              onChange={(event) =>
                setSettings((previous) => ({ ...previous, tests_weight: Number(event.target.value || 0) }))
              }
              disabled={isReadOnly}
            />
          </FormField>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className={`text-sm ${totalWeight === 100 ? 'text-success' : 'text-danger'}`}>
            Total: {totalWeight}%
          </div>
          <Button
            onClick={saveSettings}
            disabled={isReadOnly || saving || (settings.use_weights && totalWeight !== 100)}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )

  return (
    <TeacherWorkSurfaceShell
      state="workspace"
      workspaceFrame="attachedTabs"
      primary={
        <TeacherWorkSurfaceModeBar
          modes={[
            { id: 'grades', label: 'Grades' },
            { id: 'settings', label: 'Settings' },
          ]}
          activeMode={section}
          onModeChange={(mode) => onSectionChange(mode as GradebookSection)}
          ariaLabel="Gradebook sections"
        />
      }
      feedback={
        error ? (
          <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : null
      }
      summary={null}
      workspace={section === 'grades' ? gradesWorkspace : settingsWorkspace}
      workspaceClassName="bg-surface"
    />
  )
}
