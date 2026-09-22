'use client'

import { useState } from 'react'
import { TeacherGradebookVisibilityControl } from '@/components/gradebook/TeacherGradebookVisibilityControl'
import { StudentGradesView } from '@/components/gradebook/StudentGradesView'
import { StudentReturnedMarksList } from '@/components/gradebook/StudentReturnedMarks'
import type { StudentGradesResponse } from '@/lib/student-grades'

export { TeacherGradebookVisibilityControl, StudentGradesView }

const RETURNED_GRADES = [
  {
    id: 'functions-graphs',
    title: 'Functions and Graphs',
    kind: 'Test',
    score: '18 / 20',
    percent: '90%',
    counted: true,
    feedbackHref: '/classrooms/example-classroom?tab=tests',
  },
  {
    id: 'field-study',
    title: 'Field Study Reflection',
    kind: 'Classwork',
    score: '24 / 30',
    percent: '80%',
    counted: true,
    feedbackHref: '/classrooms/example-classroom?tab=assignments&assignmentId=field-study',
  },
  {
    id: 'practice-check',
    title: 'Practice Check',
    kind: 'Classwork',
    score: '8 / 10',
    percent: '80%',
    counted: false,
    feedbackHref: '/classrooms/example-classroom?tab=assignments&assignmentId=practice-check',
  },
] satisfies ReadonlyArray<{
  id: string
  title: string
  kind: 'Classwork' | 'Test'
  score: string
  percent: string
  counted: boolean
  feedbackHref: string
}>

export const VISIBLE_GRADES: StudentGradesResponse = {
  currentPercent: 84,
  items: RETURNED_GRADES.map((grade) => {
    const [earned, possible] = grade.score.split(' / ').map(Number)
    return {
      id: grade.id,
      title: grade.title,
      kind: grade.kind,
      earned,
      possible,
      percent: Number(grade.percent.replace('%', '')),
      included: grade.counted,
      href: grade.feedbackHref,
    }
  }),
}

export function StudentGradesPattern() {
  const [gradesVisible, setGradesVisible] = useState(false)

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
        <div>
          <div className="border-b border-border pb-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Teacher</p>
            <h4 className="mt-1 font-semibold text-text-default">Gradebook visibility</h4>
          </div>
          <div className="pt-3">
            <TeacherGradebookVisibilityControl gradesVisible={gradesVisible} onChange={setGradesVisible} />
          </div>
        </div>

        {gradesVisible ? (
          <StudentGradesView grades={VISIBLE_GRADES} showRoleLabel />
        ) : (
          <div data-testid="student-grades-hidden-preview" className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
            <p className="text-sm font-medium text-text-default">Grades is hidden from student navigation.</p>
            <p className="mt-1 text-xs leading-5 text-text-muted">Returned feedback remains available in Classwork and Tests.</p>
          </div>
        )}
      </div>

      <div className="space-y-3" data-testid="standalone-returned-marks-preview">
        <div>
          <h4 className="font-semibold text-text-default">Standalone marks in Classwork</h4>
          <p className="mt-1 text-sm text-text-muted">
            The current student integration shows explicitly returned standalone marks in Classwork. The aggregate Grades view above remains a prototype.
          </p>
        </div>
        <StudentReturnedMarksList items={[
          { id: 'standalone-attendance', title: 'Attendance – Term 1', earned: 18, possible: 20, percent: 90, categoryName: 'Term Work', included: true },
          { id: 'standalone-zero', title: 'Participation check', earned: 0, possible: 10, percent: 0, categoryName: 'Term Work', included: true },
          { id: 'standalone-practice', title: 'Practice conference', earned: 8, possible: 10, percent: 80, categoryName: null, included: false },
        ]} />
      </div>
    </section>
  )
}
