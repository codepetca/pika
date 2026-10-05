import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createContextualClassDayCalendar, setContextualClassDay } from '@/lib/server/contextual-class-day-mutation'
import { createClassroomCalendarSchema, setClassroomCalendarDaySchema } from '@/lib/validations/classroom-calendar'
import type { Database } from '@/types/database'
import type { getServiceRoleClient } from '@/lib/supabase'

vi.mock('@/lib/timezone', () => ({ getTodayInToronto: () => '2026-10-05' }))
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const day = (date = '2026-10-05', n = 1) => ({ id: id(n), classroom_id: classroomId, date, is_class_day: true, prompt_text: null as string | null })
const days = [day(), day('2026-10-06', 2)]
const envelope = (data: unknown) => ({ data, error: null, count: null, status: 200, statusText: 'OK' })
const errorEnvelope = (code: string) => ({ data: null, error: { code, message: 'private detail', details: null, hint: null }, count: null, status: 400, statusText: 'Bad Request' })
const rpc = vi.fn()
const supabase = { rpc } as unknown as ReturnType<typeof getServiceRoleClient>
const identity = { supabase, actorId, classroomId }
const input = () => createClassroomCalendarSchema.parse({ start_date: '2026-10-05', end_date: '2026-10-06' })
const create = () => createContextualClassDayCalendar({ ...identity, input: input() })
const set = () => setContextualClassDay({ ...identity, input: { date: '2026-10-05', is_class_day: true } })

describe('shared class-day mutation strict installed152 adapter', () => {
  beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue(envelope(days)) })

  it('binds canonical trusted identity and generates only server weekdays', async () => {
    const parsed = createClassroomCalendarSchema.parse({ start_date: '2026-10-02', end_date: '2026-10-06', actor_id: otherId, p_dates: ['1999-01-01'], dates: ['1999-01-01'], plan: 'pro' })
    const rows = [day('2026-10-02'), day('2026-10-05', 2), day('2026-10-06', 3)]
    rpc.mockResolvedValue(envelope(rows))
    await expect(createContextualClassDayCalendar({ ...identity, actorId: actorId.toUpperCase(), classroomId: classroomId.toUpperCase(), input: parsed })).resolves.toEqual({ success: true, count: 3, class_days: rows })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('create_classroom_calendar_v1', { p_actor_id: actorId, p_classroom_id: classroomId, p_start_date: '2026-10-02', p_end_date: '2026-10-06', p_dates: ['2026-10-02', '2026-10-05', '2026-10-06'] })
  })

  it('retains semester precedence, inclusive bounds and real calendar validation', async () => {
    rpc.mockImplementation(async (_name, args) => envelope(args.p_dates.map((date: string, n: number) => day(date, n + 1))))
    const parsed = createClassroomCalendarSchema.parse({ semester: 'semester1', year: 2026, start_date: 'bad', end_date: 'bad' })
    await createContextualClassDayCalendar({ ...identity, input: parsed })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_start_date: '2026-09-01', p_end_date: '2027-01-31' })
    await createContextualClassDayCalendar({ ...identity, input: createClassroomCalendarSchema.parse({ start_date: '2024-01-01', end_date: '2025-01-01' }) })
    expect(rpc.mock.calls[1][1].p_dates.length).toBeLessThanOrEqual(367)
    for (const body of [{}, { semester: 'semester1', year: '2026' }, { semester: 'semester1', year: 9999 }, { start_date: '2026-02-30', end_date: '2026-03-02' }, { start_date: '2026-10-05', end_date: '2026-10-05' }, { start_date: '2026-01-01', end_date: '2027-01-03' }]) expect(createClassroomCalendarSchema.safeParse(body).success).toBe(false)
  })

  it('rejects a weekend-only range and past Toronto toggle before RPC', async () => {
    await expect(createContextualClassDayCalendar({ ...identity, input: createClassroomCalendarSchema.parse({ start_date: '2026-10-03', end_date: '2026-10-04' }) })).rejects.toMatchObject({ statusCode: 400 })
    await expect(setContextualClassDay({ ...identity, input: { date: '2026-10-04', is_class_day: true } })).rejects.toMatchObject({ statusCode: 400 })
    expect(rpc).not.toHaveBeenCalled()
    expect(setClassroomCalendarDaySchema.safeParse({ date: '2026-02-30', is_class_day: true }).success).toBe(false)
    expect(setClassroomCalendarDaySchema.safeParse({ date: '2026-10-05', is_class_day: 'true' }).success).toBe(false)
  })

  it.each(['2026-10-05', '2099-01-01'])('allows Toronto today/future %s and preserves returned prompts with five fields', async date => {
    const row = { ...day(date), is_class_day: false, prompt_text: '  Existing prompt  ' }
    rpc.mockResolvedValue(envelope([row]))
    await expect(setContextualClassDay({ ...identity, input: { date, is_class_day: false } })).resolves.toEqual({ class_day: row })
    expect(Object.keys(row)).toHaveLength(5)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('set_classroom_calendar_day_v1', { p_actor_id: actorId, p_classroom_id: classroomId, p_date: date, p_is_class_day: false })
  })

  it.each([
    ['P0002', 404], ['42501', 403], ['22023', 400], ['23505', 409], ['PGRST202', 503], ['42883', 503], ['08006', 503], ['XX000', 503],
  ])('maps genuine-shaped RPC error %s without raw details or retries', async (code, statusCode) => {
    rpc.mockResolvedValue(errorEnvelope(String(code)))
    await expect(create()).rejects.toMatchObject({ statusCode })
    await expect(set()).rejects.toMatchObject({ statusCode: code === '23505' ? 503 : statusCode })
    expect(rpc).toHaveBeenCalledTimes(2)
    await expect(create()).rejects.not.toThrow('private detail')
  })

  it.each([
    undefined, null, {}, [], { data: days }, { error: null }, { data: undefined, error: null },
    Object.create(envelope(days)), { ...envelope(days), extra: true }, { ...envelope(days), error: false },
    { ...envelope(days), status: 500 }, { ...envelope(days), count: -1 }, { ...envelope(days), count: 1.5 },
    { ...envelope(days), error: { code: '42501' } }, { ...errorEnvelope('42501'), data: days },
    { ...errorEnvelope('42501'), error: { code: '42501', message: 7 } },
    { ...errorEnvelope('42501'), error: { code: '42501', message: 'private', extra: true } },
    { ...errorEnvelope('42501'), status: 200 },
  ])('rejects false-positive or malformed SDK evidence %#', async response => {
    rpc.mockResolvedValue(response)
    await expect(create()).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    null, [], {}, [null], [day()], [...days, day('2026-10-07', 3)], [days[0], days[0]],
    [days[0], { ...days[1], id: days[0].id }], [days[0], { ...days[1], date: days[0].date }],
    [days[0], { ...days[1], classroom_id: otherId }], [days[0], { ...days[1], date: '2026-10-07' }],
    [days[0], { ...days[1], date: '2026-02-30' }], [days[0], { ...days[1], is_class_day: false }],
    [days[0], { ...days[1], id: 'bad' }], [days[0], { ...days[1], prompt_text: 7 }],
    [days[0], { ...days[1], prompt_text: undefined }], [days[0], { ...days[1], private: true }],
    Array.from({ length: 368 }, (_, n) => day('2026-10-05', n + 1)),
  ])('rejects incomplete/foreign/malformed/duplicate generation rows %#', async rows => {
    rpc.mockResolvedValue(envelope(rows))
    await expect(create()).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([null, [], [day(), day()], [day('2026-10-06')], [{ ...day(), classroom_id: otherId }], [{ ...day(), is_class_day: false }], [{ ...day(), prompt_text: undefined }]])('requires exactly one matching toggle row %#', async rows => {
    rpc.mockResolvedValue(envelope(rows))
    await expect(set()).rejects.toMatchObject({ statusCode: 503 })
  })

  it('normalizes UUID response casing before checking duplicate IDs', async () => {
    rpc.mockResolvedValue(envelope([day(), { ...days[1], id: id(1).toUpperCase() }]))
    await expect(create()).rejects.toMatchObject({ statusCode: 503 })
  })

  it('rejects malformed identities before RPC and reports transport uncertainty generically', async () => {
    await expect(createContextualClassDayCalendar({ ...identity, actorId: 'bad', input: input() })).rejects.toMatchObject({ statusCode: 400 })
    await expect(setContextualClassDay({ ...identity, classroomId: classroomId.replaceAll('-', ''), input: { date: '2026-10-05', is_class_day: true } })).rejects.toMatchObject({ statusCode: 400 })
    expect(rpc).not.toHaveBeenCalled()
    rpc.mockRejectedValue(new Error('private transport detail after possible commit'))
    await expect(create()).rejects.toMatchObject({ statusCode: 503, message: 'Unable to verify classroom calendar. Refresh before retrying.' })
    await expect(set()).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each(['create', 'set'] as const)('serializes %s through the installed typed SDK without extra claims', async operation => {
    let url = ''
    let options: RequestInit | undefined
    const fetcher = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      url = String(request); options = init
      return new Response(JSON.stringify(operation === 'create' ? days : [day()]), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const client = createClient<Database>('http://127.0.0.1:54321', 'fake-key', { global: { fetch: fetcher }, auth: { autoRefreshToken: false, persistSession: false } })
    if (operation === 'create') await createContextualClassDayCalendar({ ...identity, supabase: client, input: input() })
    else await setContextualClassDay({ ...identity, supabase: client, input: { date: '2026-10-05', is_class_day: true } })
    expect(url).toBe(`http://127.0.0.1:54321/rest/v1/rpc/${operation === 'create' ? 'create_classroom_calendar_v1' : 'set_classroom_calendar_day_v1'}`)
    expect(options?.method).toBe('POST')
    expect(JSON.parse(String(options?.body))).toEqual(operation === 'create'
      ? { p_actor_id: actorId, p_classroom_id: classroomId, p_start_date: '2026-10-05', p_end_date: '2026-10-06', p_dates: ['2026-10-05', '2026-10-06'] }
      : { p_actor_id: actorId, p_classroom_id: classroomId, p_date: '2026-10-05', p_is_class_day: true })
  })
})
