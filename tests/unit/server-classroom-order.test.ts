import { describe, expect, it, vi } from 'vitest'
import { getNextTeacherClassroomPosition, listActiveTeacherClassrooms } from '@/lib/server/classroom-order'

function makePositionQuery(result: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
  }

  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.is.mockReturnValue(query)
  query.order.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.maybeSingle.mockResolvedValue(result)

  return query
}

describe('server classroom-order helpers', () => {
  it('returns ordered classrooms when position sort succeeds', async () => {
    const result = { data: [{ id: 'c1' }], error: null }
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      order: vi.fn(),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    query.is.mockReturnValue(query)
    query.order.mockReturnValueOnce(query).mockResolvedValueOnce(result)

    const supabase = { from: vi.fn().mockReturnValue(query) }

    await expect(listActiveTeacherClassrooms(supabase as never, 'teacher-1')).resolves.toBe(result)

    expect(query.eq).toHaveBeenCalledWith('teacher_id', 'teacher-1')
    expect(query.is).toHaveBeenCalledWith('archived_at', null)
    expect(query.order).toHaveBeenNthCalledWith(1, 'position', { ascending: true })
    expect(query.order).toHaveBeenNthCalledWith(2, 'updated_at', { ascending: false })
  })

  it('falls back to updated_at ordering when position query errors', async () => {
    const fallbackResult = { data: [{ id: 'c2' }], error: null }

    const firstQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      order: vi.fn(),
    }
    firstQuery.select.mockReturnValue(firstQuery)
    firstQuery.eq.mockReturnValue(firstQuery)
    firstQuery.is.mockReturnValue(firstQuery)
    firstQuery.order
      .mockReturnValueOnce(firstQuery)
      .mockResolvedValueOnce({ data: null, error: { message: 'missing column' } })

    const fallbackQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      order: vi.fn(),
    }
    fallbackQuery.select.mockReturnValue(fallbackQuery)
    fallbackQuery.eq.mockReturnValue(fallbackQuery)
    fallbackQuery.is.mockReturnValue(fallbackQuery)
    fallbackQuery.order.mockResolvedValue(fallbackResult)

    const supabase = {
      from: vi.fn().mockReturnValueOnce(firstQuery).mockReturnValueOnce(fallbackQuery),
    }

    await expect(listActiveTeacherClassrooms(supabase as never, 'teacher-2')).resolves.toBe(fallbackResult)

    expect(supabase.from).toHaveBeenCalledTimes(2)
    expect(firstQuery.order).toHaveBeenNthCalledWith(1, 'position', { ascending: true })
    expect(firstQuery.order).toHaveBeenNthCalledWith(2, 'updated_at', { ascending: false })
    expect(fallbackQuery.eq).toHaveBeenCalledWith('teacher_id', 'teacher-2')
    expect(fallbackQuery.is).toHaveBeenCalledWith('archived_at', null)
    expect(fallbackQuery.order).toHaveBeenCalledWith('updated_at', { ascending: false })
  })

  it('returns null next position when first classroom lookup fails', async () => {
    const failing = makePositionQuery({ data: null, error: { message: 'boom' } })
    const supabase = { from: vi.fn().mockReturnValue(failing) }

    await expect(getNextTeacherClassroomPosition(supabase as never, 'teacher-3')).resolves.toBeNull()
  })

  it('returns previous position when the first classroom has a numeric position', async () => {
    const firstClassroom = makePositionQuery({ data: { position: 8 }, error: null })
    const supabase = { from: vi.fn().mockReturnValue(firstClassroom) }

    await expect(getNextTeacherClassroomPosition(supabase as never, 'teacher-4')).resolves.toBe(7)
    expect(firstClassroom.limit).toHaveBeenCalledWith(1)
  })

  it('defaults to 0 when first classroom has no numeric position', async () => {
    const missingPosition = makePositionQuery({ data: { position: null }, error: null })
    const supabase = { from: vi.fn().mockReturnValue(missingPosition) }

    await expect(getNextTeacherClassroomPosition(supabase as never, 'teacher-5')).resolves.toBe(0)
    expect(missingPosition.eq).toHaveBeenCalledWith('teacher_id', 'teacher-5')
  })
})
