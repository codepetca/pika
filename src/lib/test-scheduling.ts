import { formatDateInToronto } from '@/lib/timezone'

type ScheduledStudentTest = {
  status: string
  test_date?: string | null
  effective_access?: string | null
  student_status?: string
}

/** List presentation only. Calendar metadata and learner authorization stay independent. */
export function isTestScheduledForFuture(test: ScheduledStudentTest, today: string): boolean {
  return test.status === 'closed'
    && !!test.test_date && test.test_date > today
    && test.effective_access !== 'open'
    && (!test.student_status || test.student_status === 'not_started')
}

export function listVisibleStudentTests<T extends ScheduledStudentTest & { created_at?: string | null }>(
  tests: T[],
  today: string,
): T[] {
  return tests
    .filter(test => !isTestScheduledForFuture(test, today))
    .map((test) => {
      const createdAt = Date.parse(test.created_at ?? '')
      const date = test.test_date || (Number.isFinite(createdAt) ? formatDateInToronto(new Date(createdAt)) : '')
      return { test, date }
    })
    // Tests have a publication day. Keep the existing order within the same day.
    .sort((left, right) => right.date.localeCompare(left.date))
    .map(({ test }) => test)
}
