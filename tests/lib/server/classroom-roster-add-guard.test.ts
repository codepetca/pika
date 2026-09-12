import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertStudentsCanBeAddedToRoster, throwIfRemovedStudentRosterError } from '@/lib/server/classroom-student-removal'

const mocks = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), not: vi.fn(), order: vi.fn(), range: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => mocks }))

describe('final removal roster-add guard', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.from.mockReturnValue(mocks)
    mocks.select.mockReturnValue(mocks)
    mocks.eq.mockReturnValue(mocks)
    mocks.not.mockReturnValue(mocks)
    mocks.order.mockReturnValue(mocks)
    mocks.range.mockResolvedValue({ data: [], error: null })
  })

  it('permits new invitations without calling a restoration RPC', async () => {
    await assertStudentsCanBeAddedToRoster('class-1', ['new@example.com'])
    expect(mocks.eq).toHaveBeenCalledWith('classroom_id', 'class-1')
    expect(mocks.not).toHaveBeenCalledWith('removed_at', 'is', null)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each(['old@example.com', ' NEW@example.com '])('rejects retained identity by historical or current email: %s', async (email) => {
    mocks.range.mockResolvedValue({ data: [{ email: 'old@example.com', student: { email: 'New@Example.com' } }], error: null })
    await expect(assertStudentsCanBeAddedToRoster('class-1', [email])).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('checks later pages instead of silently allowing a removed learner', async () => {
    mocks.range.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => ({ email: 'other@example.com', student: { email: 'other@example.com' } })), error: null })
      .mockResolvedValueOnce({ data: [{ email: 'removed@example.com', student: { email: 'removed@example.com' } }], error: null })
    await expect(assertStudentsCanBeAddedToRoster('class-1', ['removed@example.com'])).rejects.toThrow('cannot be re-added')
    expect(mocks.range).toHaveBeenNthCalledWith(2, 1000, 1999)
  })

  it.each([{ code: '42703' }, { code: 'XX000', message: 'private student detail' }])('fails closed on a missing or unreadable contract', async (error) => {
    mocks.range.mockResolvedValue({ data: null, error })
    await expect(assertStudentsCanBeAddedToRoster('class-1', ['new@example.com'])).rejects.toThrow('Could not check whether these students can be added')
  })

  it('fails closed on malformed retained identity data', async () => {
    mocks.range.mockResolvedValue({ data: [{ email: 'old@example.com', student: null }], error: null })
    await expect(assertStudentsCanBeAddedToRoster('class-1', ['new@example.com'])).rejects.toThrow()
  })

  it('maps the database race guard without exposing internal details', () => {
    expect(() => throwIfRemovedStudentRosterError({ code: '55000', message: 'student_class_data_pending_purge' })).toThrow('cannot be re-added')
    expect(() => throwIfRemovedStudentRosterError({ code: 'XX000', message: 'private details' })).not.toThrow()
  })
})
