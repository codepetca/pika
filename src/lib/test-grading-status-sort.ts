import type { TeacherTestGradingStudentRow } from '@/lib/test-api-contract'

type TestGradingStatus = TeacherTestGradingStudentRow['status']
export type TestGradingStatusGroup = 'submitted' | 'returned' | 'not_submitted'
export type TestGradingStatusSort = Extract<TestGradingStatusGroup, 'submitted' | 'returned'>

// The three unsubmitted states keep their own row labels, but share one sort group.
const STATUS_GROUP: Record<TestGradingStatus, TestGradingStatusGroup> = {
  submitted: 'submitted',
  returned: 'returned',
  not_started: 'not_submitted',
  in_progress: 'not_submitted',
  closed: 'not_submitted',
}

const STATUS_GROUP_RANK: Record<TestGradingStatusSort, Record<TestGradingStatusGroup, number>> = {
  submitted: { submitted: 0, returned: 1, not_submitted: 2 },
  returned: { returned: 0, submitted: 1, not_submitted: 2 },
}

export function getTestGradingStatusGroup(status: TestGradingStatus): TestGradingStatusGroup {
  return STATUS_GROUP[status]
}

export function compareTestGradingStatusGroups(
  first: TestGradingStatus,
  second: TestGradingStatus,
  firstGroup: TestGradingStatusSort,
): number {
  const ranks = STATUS_GROUP_RANK[firstGroup]
  return ranks[getTestGradingStatusGroup(first)] - ranks[getTestGradingStatusGroup(second)]
}
