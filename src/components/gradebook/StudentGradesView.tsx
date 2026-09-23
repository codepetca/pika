import Link from 'next/link'
import type { StudentGradesResponse } from '@/lib/student-grades'
import { Card } from '@/ui'

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export function StudentGradesView({
  grades,
  showRoleLabel = false,
  onSelectGrade,
}: {
  grades: StudentGradesResponse
  showRoleLabel?: boolean
  onSelectGrade?: (title: string) => void
}) {
  return (
    <div data-testid="student-grades-view">
      <Card tone="panel" padding="none">
        <div className="border-b border-border px-4 py-3">
          {showRoleLabel ? <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Student</p> : null}
          <h2 className={showRoleLabel ? 'mt-1 font-semibold text-text-default' : 'font-semibold text-text-default'}>Grades</h2>
        </div>
        <div className="flex items-end justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-sm font-medium text-text-default">Current grade</p>
            <p className="mt-0.5 text-xs text-text-muted">Based on returned work</p>
          </div>
          <p className="text-3xl font-semibold tabular-nums text-text-default">
            {grades.currentPercent == null ? '—' : `${formatNumber(grades.currentPercent)}%`}
          </p>
        </div>
        {grades.items.length === 0 ? (
          <div className="border-t border-border px-4 py-8 text-center">
            <p className="text-sm font-medium text-text-default">No returned grades yet</p>
            <p className="mt-1 text-xs text-text-muted">Returned Classwork and Tests will appear here.</p>
          </div>
        ) : (
          <ul aria-label="Returned grades" className="divide-y divide-border border-t border-border">
            {grades.items.map((grade) => {
              const content = (
                <>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-default">{grade.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      <span>{grade.kind}</span>
                      {!grade.included ? (
                        <span className="rounded-badge bg-surface-2 px-2 py-0.5 font-medium text-text-muted">Not counted</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <p className="text-sm font-semibold text-text-default">{formatNumber(grade.percent)}%</p>
                    <p className="mt-0.5 text-xs text-text-muted">{formatNumber(grade.earned)} / {formatNumber(grade.possible)}</p>
                  </div>
                </>
              )
              const className = 'flex min-h-11 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-inset focus-visible:ring-foundation focus-visible:ring-focus'
              return (
                <li key={`${grade.kind}:${grade.id}`}>
                  {grade.href ? (
                    <Link
                      href={grade.href}
                      onClick={onSelectGrade ? (event) => { event.preventDefault(); onSelectGrade(grade.title) } : undefined}
                      className={className}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex min-h-11 items-center justify-between gap-4 px-4 py-3">{content}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
