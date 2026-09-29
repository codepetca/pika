import type { TeacherTestGradingStudentRow } from '@/lib/test-api-contract'

type TestGradingStatus = TeacherTestGradingStudentRow['status']

// The three unsubmitted states keep their own row labels, but share one sort group.
const STATUS_GROUP_RANK: Record<TestGradingStatus, number> = {
  submitted: 0,
  returned: 1,
  not_started: 2,
  in_progress: 2,
  closed: 2,
}

export function compareTestGradingStatusGroups(
  first: TestGradingStatus,
  second: TestGradingStatus,
  direction: 'asc' | 'desc',
): number {
  const difference = STATUS_GROUP_RANK[first] - STATUS_GROUP_RANK[second]
  return direction === 'asc' ? difference : -difference
}
