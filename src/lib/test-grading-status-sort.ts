import type { TeacherTestGradingStudentRow } from '@/lib/test-api-contract'

type TestGradingStatus = TeacherTestGradingStudentRow['status']
export type TestGradingStatusGroup = 'submitted' | 'returned' | 'not_submitted'

// The three unsubmitted states keep their own row labels, but share one sort group.
const STATUS_GROUP: Record<TestGradingStatus, TestGradingStatusGroup> = {
  submitted: 'submitted',
  returned: 'returned',
  not_started: 'not_submitted',
  in_progress: 'not_submitted',
  closed: 'not_submitted',
}

const STATUS_GROUP_RANK: Record<TestGradingStatusGroup, number> = {
  submitted: 0,
  returned: 1,
  not_submitted: 2,
}

export function getTestGradingStatusGroup(status: TestGradingStatus): TestGradingStatusGroup {
  return STATUS_GROUP[status]
}

export function compareTestGradingStatusGroups(
  first: TestGradingStatus,
  second: TestGradingStatus,
  direction: 'asc' | 'desc',
): number {
  const difference = STATUS_GROUP_RANK[getTestGradingStatusGroup(first)] - STATUS_GROUP_RANK[getTestGradingStatusGroup(second)]
  return direction === 'asc' ? difference : -difference
}
