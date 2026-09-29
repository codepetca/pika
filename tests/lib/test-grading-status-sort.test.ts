import { describe, expect, it } from 'vitest'
import { compareTestGradingStatusGroups, getTestGradingStatusGroup } from '@/lib/test-grading-status-sort'
import type { TeacherTestGradingStudentRow } from '@/lib/test-api-contract'

describe('Test grading status sort', () => {
  it('places every attempt state in its group for each visible header status', () => {
    const statuses: TeacherTestGradingStudentRow['status'][] = [
      'in_progress', 'returned', 'not_started', 'submitted', 'closed',
    ]

    expect([...statuses].sort((a, b) => compareTestGradingStatusGroups(a, b, 'submitted'))).toEqual([
      'submitted', 'returned', 'in_progress', 'not_started', 'closed',
    ])
    expect([...statuses].sort((a, b) => compareTestGradingStatusGroups(a, b, 'returned'))).toEqual([
      'returned', 'submitted', 'in_progress', 'not_started', 'closed',
    ])
    expect([...statuses].sort((a, b) => compareTestGradingStatusGroups(a, b, 'not_submitted'))).toEqual([
      'in_progress', 'not_started', 'closed', 'returned', 'submitted',
    ])
    expect(statuses.map(getTestGradingStatusGroup)).toEqual([
      'not_submitted', 'returned', 'not_submitted', 'submitted', 'not_submitted',
    ])
  })
})
