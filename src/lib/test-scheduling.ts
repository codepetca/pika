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
