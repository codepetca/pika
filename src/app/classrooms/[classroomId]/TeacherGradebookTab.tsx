'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Classroom, GradebookClassSummary, GradebookStudentSummary } from '@/types'
import { Button } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
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

interface GradebookSettingsState {
  use_weights: boolean
  assignments_weight: number
  quizzes_weight: number
}

interface Props {
  classroom: Classroom
  selectedStudentId?: string | null
  onSelectStudent?: (student: GradebookStudentSummary | null) => void
  onClassSummaryChange?: (summary: GradebookClassSummary | null) => void
}

function formatPercent(value: number | null): string {
  if (value == null) return '—'
  return `${value.toFixed(2)}%`
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function formatScoreWithPercent(
  earned: number | null,
  possible: number | null,
  percent: number | null
): string {
  if (earned == null || possible == null || percent == null) return '—'
  return `${formatPoints(earned)}/${formatPoints(possible)} (${percent.toFixed(2)}%)`
}

export function TeacherGradebookTab({
  classroom,
  selectedStudentId = null,
  onSelectStudent,
  onClassSummaryChange,
}: Props) {
  const isReadOnly = !!classroom.archived_at
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<GradebookSettingsState>({
    use_weights: false,
    assignments_weight: 70,
    quizzes_weight: 30,
  })
  const [students, setStudents] = useState<GradebookStudentSummary[]>([])
  const tableContainerRef = useRef<HTMLDivElement>(null)

  const rowKeys = useMemo(() => students.map((student) => student.student_id), [students])

  async function loadGradebook() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/gradebook?classroom_id=${classroom.id}`)
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load gradebook')
      }

      setSettings(data.settings)
      setStudents(data.students || [])
      onClassSummaryChange?.((data.class_summary as GradebookClassSummary | null) || null)
    } catch (err: any) {
      setError(err.message || 'Failed to load gradebook')
      onClassSummaryChange?.(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadGradebook()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroom.id, onClassSummaryChange])

  useEffect(() => {
    if (!selectedStudentId) return

    function handleMouseDown(event: MouseEvent) {
      const target = event.target as HTMLElement
      if (tableContainerRef.current?.contains(target)) return
      if (target.closest('aside') || target.closest('[role="dialog"]')) return
      onSelectStudent?.(null)
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [selectedStudentId, onSelectStudent])

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
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save settings')
      }

      setSettings(data.settings)
      await loadGradebook()
    } catch (err: any) {
      setError(err.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const totalWeight = useMemo(
    () => Number(settings.assignments_weight || 0) + Number(settings.quizzes_weight || 0),
    [settings.assignments_weight, settings.quizzes_weight]
  )

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
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-text-default">
              <input
                type="checkbox"
                checked={settings.use_weights}
                onChange={(e) => setSettings((prev) => ({ ...prev, use_weights: e.target.checked }))}
                disabled={isReadOnly}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              Use weights
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-text-default">
              Assignments
              <input
                type="number"
                min={0}
                max={100}
                value={settings.assignments_weight}
                onChange={(e) => setSettings((prev) => ({ ...prev, assignments_weight: Number(e.target.value || 0) }))}
                disabled={isReadOnly}
                className="w-20 rounded border border-border bg-surface px-2 py-1"
              />
              %
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-text-default">
              Quizzes
              <input
                type="number"
                min={0}
                max={100}
                value={settings.quizzes_weight}
                onChange={(e) => setSettings((prev) => ({ ...prev, quizzes_weight: Number(e.target.value || 0) }))}
                disabled={isReadOnly}
                className="w-20 rounded border border-border bg-surface px-2 py-1"
              />
              %
            </label>

            <div className={`text-sm ${totalWeight === 100 ? 'text-success' : 'text-danger'}`}>
              Total: {totalWeight}%
            </div>

            <Button onClick={saveSettings} disabled={isReadOnly || saving || totalWeight !== 100}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        }
      />

      <PageContent>
        <div ref={tableContainerRef}>
          <TableCard>
            {error && (
              <div className="p-3 border-b border-border">
                <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
                  {error}
                </div>
              </div>
            )}

            <KeyboardNavigableTable
              rowKeys={rowKeys}
              selectedKey={selectedStudentId}
              onSelectKey={(studentId) => {
                const student = students.find((row) => row.student_id === studentId) || null
                onSelectStudent?.(student)
              }}
              onDeselect={() => onSelectStudent?.(null)}
            >
              <DataTable>
                <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Student</DataTableHeaderCell>
                  <DataTableHeaderCell align="right">Assignments</DataTableHeaderCell>
                  <DataTableHeaderCell align="right">Quizzes</DataTableHeaderCell>
                  <DataTableHeaderCell align="right">Final %</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
                <DataTableBody>
                  {students.map((student) => {
                    const fullName = `${student.student_first_name || ''} ${student.student_last_name || ''}`.trim()
                    const isSelected = student.student_id === selectedStudentId
                    return (
                      <DataTableRow
                        key={student.student_id}
                        className={[
                          'cursor-pointer transition-colors',
                          isSelected ? 'bg-info-bg hover:bg-info-bg-hover' : 'hover:bg-surface-hover',
                        ].join(' ')}
                      onClick={() => onSelectStudent?.(isSelected ? null : student)}
                    >
                      <DataTableCell>{fullName || student.student_email}</DataTableCell>
                      <DataTableCell align="right">
                        {formatScoreWithPercent(
                          student.assignments_earned,
                          student.assignments_possible,
                          student.assignments_percent
                        )}
                      </DataTableCell>
                      <DataTableCell align="right">
                        {formatScoreWithPercent(
                          student.quizzes_earned,
                          student.quizzes_possible,
                          student.quizzes_percent
                        )}
                      </DataTableCell>
                      <DataTableCell align="right" className="font-semibold">
                        {formatPercent(student.final_percent)}
                      </DataTableCell>
                      </DataTableRow>
                    )
                  })}

                  {students.length === 0 && (
                    <EmptyStateRow colSpan={4} message="No students enrolled yet" />
                  )}
                </DataTableBody>
              </DataTable>
            </KeyboardNavigableTable>
          </TableCard>
        </div>
      </PageContent>
    </PageLayout>
  )
}
