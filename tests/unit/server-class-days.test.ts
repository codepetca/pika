import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSupabaseClient, mockGetTodayInToronto } = vi.hoisted(() => ({
  mockSupabaseClient: {
    from: vi.fn(),
  },
  mockGetTodayInToronto: vi.fn(() => '2026-04-25'),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: mockGetTodayInToronto,
}))

import {
  fetchClassDaysForClassroom,
  generateClassDaysForClassroom,
  upsertClassDayForClassroom,
} from '@/lib/server/class-days'

describe('server class-day helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from.mockReset()
    mockGetTodayInToronto.mockReturnValue('2026-04-25')
  })

  it('fetches class days sorted by date', async () => {
    const order = vi.fn(async () => ({ data: [{ id: 'day-1', date: '2026-04-27' }], error: null }))
    mockSupabaseClient.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ order })),
      })),
    })

    await expect(fetchClassDaysForClassroom('classroom-1')).resolves.toEqual({
      classDays: [{ id: 'day-1', date: '2026-04-27' }],
      error: null,
    })
    expect(order).toHaveBeenCalledWith('date', { ascending: true })
  })

  it('rejects generation when class days already exist or params are incomplete', async () => {
    mockSupabaseClient.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(async () => ({ data: [{ id: 'existing' }], error: null })),
        })),
      })),
    })

    await expect(generateClassDaysForClassroom({
      classroomId: 'classroom-1',
      semester: 'semester1',
      year: 2026,
    })).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Class days already exist for this classroom. Use PATCH to update.',
    })

    mockSupabaseClient.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(async () => ({ data: [], error: null })),
        })),
      })),
    })

    await expect(generateClassDaysForClassroom({
      classroomId: 'classroom-1',
    })).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Either (semester + year) or (start_date + end_date) are required',
    })
  })

  it('validates custom ranges before creating rows', async () => {
    mockSupabaseClient.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(async () => ({ data: [], error: null })),
        })),
      })),
    })

    await expect(generateClassDaysForClassroom({
      classroomId: 'classroom-1',
      startDate: '2026-04-03',
      endDate: '2026-04-01',
    })).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'end_date must be after start_date',
    })
  })

  it('returns range update and insert failures during generation', async () => {
    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table === 'class_days') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(async () => ({ data: [], error: null })),
            })),
          })),
        }
      }
      if (table === 'classrooms') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: { message: 'range failed' } })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    await expect(generateClassDaysForClassroom({
      classroomId: 'classroom-1',
      startDate: '2026-04-01',
      endDate: '2026-04-03',
    })).resolves.toEqual({
      ok: false,
      status: 500,
      error: 'Failed to update classroom calendar range',
    })

    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table === 'class_days') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(async () => ({ data: [], error: null })),
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(async () => ({ data: null, error: { message: 'insert failed' } })),
          })),
        }
      }
      if (table === 'classrooms') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    await expect(generateClassDaysForClassroom({
      classroomId: 'classroom-1',
      startDate: '2026-04-01',
      endDate: '2026-04-03',
    })).resolves.toEqual({
      ok: false,
      status: 500,
      error: 'Failed to create class days',
    })
  })

  it('creates custom range class days after updating the classroom range', async () => {
    const classroomUpdate = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
    const insert = vi.fn(() => ({
      select: vi.fn(async () => ({
        data: [
          { date: '2026-04-01' },
          { date: '2026-04-02' },
        ],
        error: null,
      })),
    }))
    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table === 'class_days') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(async () => ({ data: [], error: null })),
            })),
          })),
          insert,
        }
      }
      if (table === 'classrooms') {
        return { update: classroomUpdate }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    await expect(generateClassDaysForClassroom({
      classroomId: 'classroom-1',
      startDate: '2026-04-01',
      endDate: '2026-04-03',
    })).resolves.toEqual({
      ok: true,
      count: 2,
      classDays: [
        { date: '2026-04-01' },
        { date: '2026-04-02' },
      ],
    })
    expect(classroomUpdate).toHaveBeenCalledWith({
      start_date: '2026-04-01',
      end_date: '2026-04-03',
    })
    expect(insert).toHaveBeenCalledWith([
      { classroom_id: 'classroom-1', date: '2026-04-01', is_class_day: true, prompt_text: null },
      { classroom_id: 'classroom-1', date: '2026-04-02', is_class_day: true, prompt_text: null },
    ])
  })

  it('rejects invalid and past upsert dates before querying Supabase', async () => {
    await expect(upsertClassDayForClassroom({
      classroomId: 'classroom-1',
      date: '04/26/2026',
      isClassDay: true,
    })).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Invalid date format (use YYYY-MM-DD)',
    })

    await expect(upsertClassDayForClassroom({
      classroomId: 'classroom-1',
      date: '2026-04-24',
      isClassDay: true,
    })).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Cannot modify past class days',
    })
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('creates a class day when no row exists and updates when one exists', async () => {
    mockSupabaseClient.from.mockImplementation(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({ data: null, error: { code: 'PGRST116' } })),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: { id: 'day-1', date: '2026-04-27', is_class_day: true },
            error: null,
          })),
        })),
      })),
    }))

    await expect(upsertClassDayForClassroom({
      classroomId: 'classroom-1',
      date: '2026-04-27',
      isClassDay: true,
    })).resolves.toEqual({
      ok: true,
      classDay: { id: 'day-1', date: '2026-04-27', is_class_day: true },
    })

    mockSupabaseClient.from.mockReset()
    mockSupabaseClient.from.mockImplementation(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: 'day-1' }, error: null })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { id: 'day-1', date: '2026-04-27', is_class_day: false },
              error: null,
            })),
          })),
        })),
      })),
    }))

    await expect(upsertClassDayForClassroom({
      classroomId: 'classroom-1',
      date: '2026-04-27',
      isClassDay: false,
    })).resolves.toEqual({
      ok: true,
      classDay: { id: 'day-1', date: '2026-04-27', is_class_day: false },
    })
  })
})
