import { describe, expect, it, vi } from 'vitest'
import { validateClassroomStudentIds } from '@/lib/server/classroom-enrollment-validation'

describe('validateClassroomStudentIds', () => {
  it('chunks large student lists and reports missing student ids', async () => {
    const inCalls: string[][] = []
    const enrolledStudentIds = Array.from({ length: 51 }, (_, index) => `student-${index + 1}`)
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn((_column: string, values: string[]) => {
              inCalls.push(values)
              return Promise.resolve({
                data: values
                  .filter((studentId) => studentId !== 'student-51')
                  .map((student_id) => ({ student_id })),
                error: null,
              })
            }),
          })),
        })),
      })),
    }

    const result = await validateClassroomStudentIds(supabase, 'classroom-1', enrolledStudentIds)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(inCalls).toHaveLength(2)
    expect(inCalls[0]).toHaveLength(50)
    expect(inCalls[1]).toEqual(['student-51'])
    expect(result.missingStudentIds).toEqual(['student-51'])
    expect(result.enrolledStudentIds.has('student-50')).toBe(true)
  })
})
