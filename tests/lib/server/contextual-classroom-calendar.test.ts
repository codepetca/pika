import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getServiceRoleClient } from '@/lib/supabase'
import { createContextualClassroomCalendar, setContextualClassroomCalendarDay } from '@/lib/server/contextual-classroom-calendar'
import { createClassroomCalendarSchema, setClassroomCalendarDaySchema } from '@/lib/validations/classroom-calendar'
import type { ClassroomAccessContext } from '@/lib/access/classroom-policy'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/timezone', () => ({ getTodayInToronto: () => '2026-09-01' }))
const actor = '11111111-1111-4111-8111-111111111111'
const classroom = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const other = '22222222-2222-4222-8222-222222222222'
const context: ClassroomAccessContext = { userId: actor, classroomId: classroom, ownerId: actor, relationship: 'owner', archived: false }
const row = { id: other, classroom_id: classroom, date: '2026-09-08', is_class_day: true, prompt_text: null }
const firstRow = { ...row, id: actor, date: '2026-09-07' }
const rpc = vi.fn()
const input = () => createClassroomCalendarSchema.parse({ start_date: '2026-09-07', end_date: '2026-09-08' })

describe('contextual classroom calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockResolvedValue({ data: [firstRow, row], error: null })
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getServiceRoleClient>)
  })
  it('generates Ontario class dates on the server and binds only trusted identity', async () => {
    const parsed = createClassroomCalendarSchema.parse({ start_date: '2026-09-07', end_date: '2026-09-08', dates: ['2026-09-07'], actor_id: other, plan: 'pro' })
    expect(await createContextualClassroomCalendar(context, parsed)).toEqual({ success: true, count: 2, class_days: [firstRow, row] })
    expect(rpc).toHaveBeenCalledWith('create_classroom_calendar_v1', {
      p_actor_id: actor, p_classroom_id: classroom, p_start_date: '2026-09-07', p_end_date: '2026-09-08', p_dates: ['2026-09-07', '2026-09-08'],
    })
  })
  it('supports the existing semester ranges', async () => {
    rpc.mockImplementation(async (_name, args) => ({ data: args.p_dates.map((date: string, index: number) => ({ ...row, id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`, date })), error: null }))
    await createContextualClassroomCalendar(context, createClassroomCalendarSchema.parse({ semester: 'semester1', year: 2026 }))
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_start_date: '2026-09-01', p_end_date: '2027-01-31' })
  })
  it.each([
    {}, { start_date: '2026-02-30', end_date: '2026-03-02' },
    { start_date: '2026-09-08', end_date: '2026-09-08' },
    { start_date: '2026-01-01', end_date: '2028-01-01' },
    { semester: 'invalid', year: 2026 }, { semester: 'semester1', year: '2026' },
  ])('rejects malformed or unbounded generation %j', (body) => {
    expect(createClassroomCalendarSchema.safeParse(body).success).toBe(false)
  })
  it('rejects a range without class days before the database', async () => {
    await expect(createContextualClassroomCalendar(context, createClassroomCalendarSchema.parse({ start_date: '2026-09-05', end_date: '2026-09-06' }))).rejects.toMatchObject({ statusCode: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([{ ...context, archived: true }, { ...context, userId: other, relationship: 'member' as const }])('rejects an inactive or nonowner context', async (denied) => {
    await expect(createContextualClassroomCalendar(denied, input())).rejects.toMatchObject({ statusCode: 403 })
    await expect(setContextualClassroomCalendarDay(denied, { date: row.date, is_class_day: true })).rejects.toMatchObject({ statusCode: 403 })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('rejects invalid calendar dates, nonboolean toggles, and Toronto past days', async () => {
    expect(setClassroomCalendarDaySchema.safeParse({ date: '2026-02-30', is_class_day: true }).success).toBe(false)
    expect(setClassroomCalendarDaySchema.safeParse({ date: row.date, is_class_day: 'false' }).success).toBe(false)
    await expect(setContextualClassroomCalendarDay(context, { date: '2026-08-31', is_class_day: true })).rejects.toMatchObject({ statusCode: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('uses the atomic toggle RPC and preserves the returned prompt', async () => {
    rpc.mockResolvedValue({ data: [{ ...row, prompt_text: 'Existing' }], error: null })
    expect(await setContextualClassroomCalendarDay(context, { date: row.date, is_class_day: true })).toEqual({ class_day: { ...row, prompt_text: 'Existing' } })
    expect(rpc).toHaveBeenCalledWith('set_classroom_calendar_day_v1', { p_actor_id: actor, p_classroom_id: classroom, p_date: row.date, p_is_class_day: true })
  })
  it.each([['P0002', 404], ['42501', 403], ['22023', 400], ['23505', 409], ['PGRST202', 503], ['42883', 503], ['08006', 503]])('maps RPC %s without leaking messages or falling back', async (code, statusCode) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private database detail' } })
    await expect(createContextualClassroomCalendar(context, input())).rejects.toMatchObject({ statusCode })
    await expect(createContextualClassroomCalendar(context, input())).rejects.not.toThrow('private database detail')
  })
  it.each([null, [], [{ ...row, classroom_id: other }], [{ ...row, date: '2026-09-09' }], [{ ...row, is_class_day: false }], [row, row], [{ ...row, id: null }]])('fails closed on invalid generation evidence %j', async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(createContextualClassroomCalendar(context, input())).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([null, [], [row, row], [{ ...row, classroom_id: other }], [{ ...row, date: '2026-09-09' }], [{ ...row, is_class_day: false }]])('fails closed on invalid toggle evidence %j', async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(setContextualClassroomCalendarDay(context, { date: row.date, is_class_day: true })).rejects.toMatchObject({ statusCode: 503 })
  })
})
