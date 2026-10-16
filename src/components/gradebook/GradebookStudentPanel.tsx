'use client'

import { X } from 'lucide-react'
import type { GradebookAssessmentColumn, GradebookStudentSummary } from '@/types'
import { Button, IconButton, Tooltip, cn } from '@/ui'
import { AssessmentStatusIndicator, getGradebookAssessmentStatusDisplay } from '@/components/AssessmentStatusIndicator'
import markStyles from './GradebookMark.module.css'
import { isUnreturnedGradebookMark, UNRETURNED_GRADEBOOK_MARK_LABEL, getStudentName, getStudentDisplayId, formatPercent, getGradePercentTextClass, getAssessmentCell, formatCompactPercent, formatAssessmentRawScore, getAssessmentColumnKey, getAssessmentCellPercent, getAssessmentMeta, type ScoreDisplayMode } from '@/lib/gradebook-display'

export function GradebookStudentPanel({
  student,
  columns,
  displayMode,
  onClose,
  onItemOpen,
  onItemScoreOpen,
  isReadOnly = false,
  compactZeroWeightAssessments = true,
}: {
  student: GradebookStudentSummary
  columns: GradebookAssessmentColumn[]
  displayMode: ScoreDisplayMode
  onClose?: () => void
  onItemOpen?: (column: GradebookAssessmentColumn) => void
  onItemScoreOpen?: (student: GradebookStudentSummary, column: GradebookAssessmentColumn) => void
  isReadOnly?: boolean
  compactZeroWeightAssessments?: boolean
}) {
  return (
    <aside
      role="region"
      aria-label={`${getStudentName(student)} assessment details`}
      className="flex h-full min-h-0 flex-col bg-surface"
    >
      <div className="flex min-h-14 items-start justify-between gap-3 px-3 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-text-default">
            {getStudentName(student)}
          </h2>
          <div className="mt-0.5 text-xs text-text-muted">
            {getStudentDisplayId(student)}
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <div className="rounded-md bg-gradebook-final px-2 py-1 text-right">
            <div className="text-xs font-semibold uppercase tracking-normal text-text-muted">Final</div>
            <div className={[
              'text-sm font-semibold tabular-nums',
              getGradePercentTextClass(student.final_percent),
            ].join(' ')}>
              {formatPercent(student.final_percent)}
            </div>
          </div>
          {onClose ? <IconButton icon={X} label="Close student details" onClick={onClose} /> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {columns.length ? (
          <div>
            {columns.map((column) => {
              const compactZero = compactZeroWeightAssessments && column.weight === 0
              const cell = getAssessmentCell(student, column)
              const percentScore = cell?.is_graded ? formatCompactPercent(cell.percent) : 'Not graded'
              const rawScore = formatAssessmentRawScore(cell, column.possible)
              const primaryScore = displayMode === 'raw' ? rawScore : percentScore
              const secondaryScore = displayMode === 'raw' ? percentScore : rawScore
              const statusDisplay = getGradebookAssessmentStatusDisplay(cell?.status)
              const key = getAssessmentColumnKey(column)
              const unreturned = isUnreturnedGradebookMark(cell)
              const scoreTextClass = cell?.is_graded && !(compactZero && (getAssessmentCellPercent(cell) ?? 0) <= 100)
                ? getGradePercentTextClass(getAssessmentCellPercent(cell))
                : 'text-text-muted'
              const scoreContent = (
                <div tabIndex={unreturned ? 0 : undefined} role={unreturned ? 'img' : undefined}
                  aria-label={unreturned ? `${primaryScore}, ${secondaryScore}${compactZero ? ", 0 weight" : ""}, ${UNRETURNED_GRADEBOOK_MARK_LABEL}` : undefined}
                  className={cn('shrink-0 rounded text-right focus:outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-offset-foundation focus-visible:ring-offset-surface', compactZero && 'flex items-center gap-1')}
                  title={!unreturned && compactZero ? `0 weight · ${secondaryScore}` : undefined}>
                  {compactZero ? <span className="mr-1 text-xs text-text-muted">0 wt</span> : null}
                  {column.assessment_type === 'item' && onItemScoreOpen ? (
                    <Button
                      type="button" variant="ghost" size="sm"
                      className={`px-1 font-normal tabular-nums ${scoreTextClass}`}
                      disabled={isReadOnly}
                      aria-label={`Edit ${getStudentName(student)} item mark for ${column.title}: ${primaryScore}`}
                      onClick={() => onItemScoreOpen(student, column)}
                    >
                      {primaryScore}
                    </Button>
                  ) : (
                    <div className={`text-sm font-normal tabular-nums ${scoreTextClass}`}><span data-unreturned-mark={unreturned || undefined} className={cn(scoreTextClass, unreturned && 'rounded-sm px-1 py-0.5', unreturned && markStyles.unreturned)}>{primaryScore}</span></div>
                  )}
                  <div className={compactZero ? 'sr-only' : ['mt-1 text-xs tabular-nums', scoreTextClass].join(' ')}>
                    {secondaryScore}
                  </div>
                </div>
              )
              return (
                <div key={key} data-compact-zero-weight={compactZero || undefined} className={cn('px-3', compactZero ? 'py-1' : 'py-2.5')}>
                  <div className={cn('flex justify-between gap-3', compactZero ? 'min-h-11 items-center' : 'items-start')}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn('rounded-sm bg-surface-2 px-1.5 py-0.5 text-xs font-normal tabular-nums', compactZero ? 'text-text-muted' : 'text-text-default')}>
                          {column.code}
                        </span>
                        {column.assessment_type === 'item' && onItemOpen ? (
                          <Button
                            type="button" variant="ghost" size="sm"
                            className={cn('min-w-0 truncate px-1 text-left font-normal', compactZero && 'text-text-muted')}
                            disabled={isReadOnly} aria-label={`Edit item: ${column.title}`}
                            onClick={() => onItemOpen(column)}
                          >
                            {column.title}
                          </Button>
                        ) : (
                          <span className={cn('truncate text-sm font-normal', compactZero ? 'text-text-muted' : 'text-text-default')} title={column.title}>{column.title}</span>
                        )}
                      </div>
                      <div className={compactZero ? 'sr-only' : 'mt-1 flex min-w-0 items-center gap-1.5 text-xs text-text-muted'}>
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
                    {unreturned ? <Tooltip content={UNRETURNED_GRADEBOOK_MARK_LABEL} openOnClick>{scoreContent}</Tooltip> : scoreContent}
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
