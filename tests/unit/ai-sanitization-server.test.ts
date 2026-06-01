import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLoadChunkedRows } = vi.hoisted(() => ({
  mockLoadChunkedRows: vi.fn(),
}))

vi.mock('@/lib/server/query-chunks', () => ({
  loadChunkedRows: mockLoadChunkedRows,
}))

import {
  AiSanitizationContextLoadError,
  loadClassroomAiSanitizationContext,
} from '@/lib/server/ai-sanitization'

function buildQueryResult(data: unknown, error: unknown = null) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(async () => ({ data, error })),
    })),
  }
}

describe('loadClassroomAiSanitizationContext', () => {
  beforeEach(() => {
    mockLoadChunkedRows.mockReset()
  })

  it('builds a roster-aware context from enrollment profiles and roster rows', async () => {
    mockLoadChunkedRows.mockResolvedValue({
      rows: [
        { user_id: 'student-1', first_name: 'Alice', last_name: 'Brown' },
      ],
      error: null,
    })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return buildQueryResult([{ student_id: 'student-1' }])
        }
        if (table === 'classroom_roster') {
          return buildQueryResult([{ first_name: 'Bob', last_name: 'Carter' }])
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const context = await loadClassroomAiSanitizationContext(supabase as any, 'classroom-1')

    expect(context.students).toEqual([
      { firstName: 'Alice', lastName: 'Brown' },
      { firstName: 'Bob', lastName: 'Carter' },
    ])
    expect(context.initialsMap).toEqual({
      'A.B.': 'Alice Brown',
      'B.C.': 'Bob Carter',
    })
  })

  it('returns an empty context after successful empty roster/profile reads', async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'classroom_enrollments') return buildQueryResult([])
        if (table === 'classroom_roster') return buildQueryResult([])
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const context = await loadClassroomAiSanitizationContext(supabase as any, 'classroom-1')

    expect(context).toEqual({
      students: [],
      initialsMap: {},
    })
    expect(mockLoadChunkedRows).not.toHaveBeenCalled()
  })

  it('fails closed when enrollment names cannot be loaded', async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return buildQueryResult(null, { message: 'enrollments failed' })
        }
        if (table === 'classroom_roster') return buildQueryResult([])
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await expect(
      loadClassroomAiSanitizationContext(supabase as any, 'classroom-1'),
    ).rejects.toThrow(AiSanitizationContextLoadError)
  })

  it('fails closed when profile names cannot be loaded', async () => {
    mockLoadChunkedRows.mockResolvedValue({
      rows: [],
      error: { message: 'profiles failed' },
    })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return buildQueryResult([{ student_id: 'student-1' }])
        }
        if (table === 'classroom_roster') return buildQueryResult([])
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await expect(
      loadClassroomAiSanitizationContext(supabase as any, 'classroom-1'),
    ).rejects.toThrow('Failed to load student profile names for AI sanitization')
  })
})
