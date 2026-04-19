import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listActiveTeacherClassrooms, getNextTeacherClassroomPosition } from '@/lib/server/classroom-order'
import { makeQueryBuilder, makeSupabaseFromQueues } from '../../support/supabase'

describe('classroom-order server helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists active classrooms ordered by position when the column is available', async () => {
    const positioned = makeQueryBuilder({ data: [{ id: 'c-1' }], error: null })
    const supabase = makeSupabaseFromQueues({ classrooms: [positioned] }) as any

    const result = await listActiveTeacherClassrooms(supabase, 'teacher-1')

    expect(result.data).toEqual([{ id: 'c-1' }])
    expect(positioned.order).toHaveBeenCalledWith('position', { ascending: true })
  })

  it('falls back to updated_at ordering when position ordering fails', async () => {
    const broken = makeQueryBuilder({ data: null, error: { message: 'missing position' } })
    const fallback = makeQueryBuilder({ data: [{ id: 'c-2' }], error: null })
    const supabase = makeSupabaseFromQueues({ classrooms: [broken, fallback] }) as any

    const result = await listActiveTeacherClassrooms(supabase, 'teacher-1')

    expect(result.data).toEqual([{ id: 'c-2' }])
    expect(fallback.order).toHaveBeenCalledWith('updated_at', { ascending: false })
  })

  it('computes the next top classroom position and handles missing data', async () => {
    const withPosition = makeQueryBuilder({ data: { position: -3 }, error: null })
    const withoutPosition = makeQueryBuilder({ data: null, error: null })
    const withError = makeQueryBuilder({ data: null, error: { message: 'boom' } })

    await expect(getNextTeacherClassroomPosition(makeSupabaseFromQueues({ classrooms: [withPosition] }) as any, 'teacher-1'))
      .resolves.toBe(-4)
    await expect(getNextTeacherClassroomPosition(makeSupabaseFromQueues({ classrooms: [withoutPosition] }) as any, 'teacher-1'))
      .resolves.toBe(0)
    await expect(getNextTeacherClassroomPosition(makeSupabaseFromQueues({ classrooms: [withError] }) as any, 'teacher-1'))
      .resolves.toBeNull()
  })
})
