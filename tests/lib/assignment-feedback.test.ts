import { describe, expect, it, vi } from 'vitest'
import { loadAssignmentFeedbackEntries } from '@/lib/server/assignment-feedback'

describe('loadAssignmentFeedbackEntries', () => {
  it('uses an injected client and rejects null evidence only in strict mode', async () => {
    const query: any = {
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null }),
    }
    const supabase = {
      from: vi.fn(() => ({ select: vi.fn(() => query) })),
    }

    await expect(loadAssignmentFeedbackEntries('assignment-1', 'student-1', {
      supabase: supabase as never,
    })).resolves.toEqual([])
    await expect(loadAssignmentFeedbackEntries('assignment-1', 'student-1', {
      supabase: supabase as never,
      requireDataArray: true,
    })).rejects.toThrow('Failed to verify assignment feedback history')
  })
})
