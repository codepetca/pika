'use client'

import { useState } from 'react'
import { SettingsSwitchRow } from '@/components/settings/SettingsSwitchRow'
import { Card } from '@/ui'

const RETURNED_GRADES = [
  {
    id: 'functions-graphs',
    title: 'Functions and Graphs',
    kind: 'Test',
    score: '18 / 20',
    percent: '90%',
    counted: true,
  },
  {
    id: 'field-study',
    title: 'Field Study Reflection',
    kind: 'Classwork',
    score: '24 / 30',
    percent: '80%',
    counted: true,
  },
  {
    id: 'practice-check',
    title: 'Practice Check',
    kind: 'Classwork',
    score: '8 / 10',
    percent: '80%',
    counted: false,
  },
] as const

export function StudentGradesPattern() {
  const [gradesVisible, setGradesVisible] = useState(true)

  return (
    <section
      id="student-grades-visibility"
      data-testid="student-grades-pattern"
      aria-labelledby="student-grades-pattern-heading"
      className="space-y-4"
    >
      <div className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-warning">Experimental · paired workflow</p>
        <h3 id="student-grades-pattern-heading" className="mt-1 text-lg font-semibold text-text-default">
          Student Grades visibility
        </h3>
        <p className="mt-1 text-sm leading-6 text-text-muted">
          One teacher control reveals one returned-only student view. The examples are fixed and make no API calls.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card tone="panel" padding="md">
          <div className="border-b border-border pb-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Teacher</p>
            <h4 className="mt-1 font-semibold text-text-default">Gradebook visibility</h4>
          </div>
          <SettingsSwitchRow
            checked={gradesVisible}
            onChange={setGradesVisible}
            ariaLabel="Show grades to students"
            className="py-4"
          >
            <span className="block font-medium">Show grades to students</span>
            <span className="mt-0.5 block text-xs leading-5 text-text-muted">
              Students see their current grade and returned work.
            </span>
          </SettingsSwitchRow>
          <p className="border-t border-border pt-3 text-xs leading-5 text-text-muted">
            Returning Classwork or a Test remains the release action for each result.
          </p>
        </Card>

        <Card tone="panel" padding="none">
          <div className="border-b border-border px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Student</p>
            <h4 className="mt-1 font-semibold text-text-default">Grades</h4>
          </div>

          <div aria-live="polite">
            {gradesVisible ? (
              <div data-testid="student-grades-visible-preview">
                <div className="flex items-end justify-between gap-4 px-4 py-4">
                  <div>
                    <p className="text-sm font-medium text-text-default">Current grade</p>
                    <p className="mt-0.5 text-xs text-text-muted">Based on returned work</p>
                  </div>
                  <p className="text-3xl font-semibold tabular-nums text-text-default">84%</p>
                </div>

                <ul aria-label="Returned grades" className="divide-y divide-border border-t border-border">
                  {RETURNED_GRADES.map((grade) => (
                    <li key={grade.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text-default">{grade.title}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                          <span>{grade.kind}</span>
                          {!grade.counted ? (
                            <span className="rounded-badge bg-surface-2 px-2 py-0.5 font-medium text-text-muted">
                              Not counted
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="shrink-0 text-right tabular-nums">
                        <p className="text-sm font-semibold text-text-default">{grade.percent}</p>
                        <p className="mt-0.5 text-xs text-text-muted">{grade.score}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div data-testid="student-grades-hidden-preview" className="px-4 py-8 text-center">
                <p className="text-sm font-medium text-text-default">Grades is hidden from student navigation.</p>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  Returned feedback remains available in Classwork and Tests.
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </section>
  )
}
