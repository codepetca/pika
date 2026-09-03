'use client'

import { X } from 'lucide-react'
import type { GradebookAssessmentColumn, GradebookStudentSummary } from '@/types'
import { IconButton } from '@/ui'
import { AssessmentStatusIndicator, getGradebookAssessmentStatusDisplay } from '@/components/AssessmentStatusIndicator'
import { getStudentName, getStudentDisplayId, formatPercent, getGradePercentTextClass, getAssessmentCell, formatCompactPercent, formatAssessmentRawScore, getAssessmentColumnKey, getAssessmentCellPercent, getAssessmentMeta, type ScoreDisplayMode } from '@/lib/gradebook-display'

export function GradebookStudentPanel({
  student,
  columns,
  displayMode,
  onClose,
}: {
  student: GradebookStudentSummary
  columns: GradebookAssessmentColumn[]
  displayMode: ScoreDisplayMode
  onClose: () => void
}) {
  return (
    <aside
      role="region"
      aria-label={`${getStudentName(student)} assessment details`}
      className="flex h-full min-h-0 flex-col bg-surface"
    >
      <div className="flex min-h-14 items-start justify-between gap-3 border-b border-border px-3 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-text-default">
            {getStudentName(student)}
          </h2>
          <div className="mt-0.5 text-xs text-text-muted">
            {getStudentDisplayId(student)}
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <div className="rounded-md bg-surface-2 px-2 py-1 text-right">
            <div className="text-xs font-semibold uppercase tracking-normal text-text-muted">Final</div>
            <div className={[
              'text-sm font-semibold tabular-nums',
              getGradePercentTextClass(student.final_percent),
            ].join(' ')}>
              {formatPercent(student.final_percent)}
            </div>
          </div>
          <IconButton icon={X} label="Close student details" onClick={onClose} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {columns.length ? (
          <div className="divide-y divide-border">
            {columns.map((column) => {
              const cell = getAssessmentCell(student, column)
              const percentScore = cell?.is_graded ? formatCompactPercent(cell.percent) : 'Not graded'
              const rawScore = formatAssessmentRawScore(cell, column.possible)
              const primaryScore = displayMode === 'raw' ? rawScore : percentScore
              const secondaryScore = displayMode === 'raw' ? percentScore : rawScore
              const statusDisplay = getGradebookAssessmentStatusDisplay(cell?.status)
              const key = getAssessmentColumnKey(column)
              const scoreTextClass = cell?.is_graded
                ? getGradePercentTextClass(getAssessmentCellPercent(cell))
                : 'text-text-muted'
              return (
                <div key={key} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-xs font-normal tabular-nums text-text-default">
                          {column.code}
                        </span>
                        <span className="truncate text-sm font-normal text-text-default" title={column.title}>
                          {column.title}
                        </span>
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
                        {statusDisplay ? (
                          <>
                            <AssessmentStatusIndicator
                              display={statusDisplay}
                              iconClassName="shrink-0"
                            />
                            <span aria-hidden="true">|</span>
                          </>
                        ) : null}
                        <span className="truncate">{getAssessmentMeta(column)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={[
                        'text-sm font-normal tabular-nums',
                        scoreTextClass,
                      ].join(' ')}>
                        {primaryScore}
                      </div>
                      <div className={['mt-1 text-xs tabular-nums', scoreTextClass].join(' ')}>
                        {secondaryScore}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="px-3 py-6 text-sm text-text-muted">
            No assessments yet.
          </div>
        )}
      </div>
    </aside>
  )
}
