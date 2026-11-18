import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST, PATCH } from '@/app/api/student/entries/route'
import { dailyLogPatchSchema } from '@/lib/validations/daily-log'

const state = vi.hoisted(() => ({
  mode: 'legacy' as 'legacy' | 'pal' | 'contextual',
  exists: false,
  insert: vi.fn(), update: vi.fn(), rpcSave: vi.fn(), palSave: vi.fn(),
}))
const classroomId = '22222222-2222-4222-8222-222222222222'
const studentId = '11111111-1111-4111-8111-111111111111'
const entryId = '33333333-3333-4333-8333-333333333333'
const content = { type: 'doc', content: [] }
function entry() { return { id: entryId, student_id: studentId, classroom_id: classroomId, date: '2026-11-18', version: 1, text: '', rich_content: content, minutes_reported: null, mood: null, on_time: true, created_at: '2026-11-18T12:00:00Z', updated_at: '2026-11-18T12:00:00Z' } }
function chain(result: unknown) {
  const query: Record<string, unknown> = {}
  query.select = query.eq = () => query
  query.single = query.maybeSingle = async () => result
  query.insert = state.insert
  query.update = state.update
  return query
}
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from: (table: string) => chain(table === 'class_days'
  ? { data: { is_class_day: true }, error: null }
  : state.exists ? { data: entry(), error: null } : { data: null, error: { code: 'PGRST116' } }) }) }))
vi.mock('@/lib/server/contextual-daily-log-access', () => ({ authorizeContextualDailyLogRequest: async (read: () => Promise<string>) => ({
  mode: state.mode === 'contextual' ? 'contextual' : 'legacy', classroomId: await read(), user: { id: studentId, role: 'student' },
}) }))
vi.mock('@/lib/server/classrooms', () => ({ assertStudentCanAccessClassroom: async () => ({ ok: true }) }))
vi.mock('@/lib/timezone', () => ({ getTodayInToronto: () => '2026-11-18', isOnTime: () => true }))
vi.mock('@/lib/server/pal-config', () => ({ isClassroomPalRequested: () => false }))
vi.mock('@/lib/server/daily-log-pal', () => ({ prepareDailyLogPal: () => ({ enabled: state.mode === 'pal', event: null }), deliverDailyLogPal: vi.fn() }))
vi.mock('@/lib/server/pal-source-writes', () => ({ upsertStudentEntryWithPalEvent: state.palSave }))
vi.mock('@/lib/server/contextual-daily-log-save', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/contextual-daily-log-save')>(), saveContextualDailyLog: state.rpcSave,
}))
function request(method: string, values: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/student/entries', { method, body: JSON.stringify({ classroom_id: classroomId, date: '2026-11-18', ...values }) })
}
function expectNoWrites() {
  expect(state.insert).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled()
  expect(state.rpcSave).not.toHaveBeenCalled(); expect(state.palSave).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.clearAllMocks(); state.exists = false
  state.insert.mockImplementation(() => chain({ data: entry(), error: null }))
  state.update.mockImplementation(() => chain({ data: entry(), error: null }))
  state.rpcSave.mockResolvedValue({ ok: true, entry: entry() })
  state.palSave.mockResolvedValue({ ok: true, entry: entry() })
})

describe('Daily Log write preconditions and expansion bounds', () => {
  it.each(['legacy', 'pal', 'contextual'] as const)('rejects a missing positive expected revision in %s mode', async mode => {
    state.mode = mode
    const response = await POST(request('POST', { version: 4, rich_content: content }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Entry has been updated elsewhere', entry: null })
    expectNoWrites()
  })
  it.each(['legacy', 'pal', 'contextual'] as const)('accepts zero as an absent-entry precondition in %s mode', async mode => {
    state.mode = mode
    expect((await POST(request('POST', { version: 0, rich_content: content }))).status).toBe(200)
  })
  it.each(['legacy', 'contextual'] as const)('rejects an expanding patch before %s persistence', async mode => {
    state.mode = mode; state.exists = true
    const patch = [{ op: 'add', path: '/attrs', value: { x: 'x'.repeat(59_000) } },
      ...Array.from({ length: 5 }, (_, i) => ({ op: 'copy', from: '', path: `/expanded${i}` }))]
    const values = { classroom_id: classroomId, date: '2026-11-18', entry_id: entryId, version: 1, patch }
    expect(dailyLogPatchSchema.safeParse(values).success).toBe(true)
    const response = await PATCH(request('PATCH', values))
    expect(response.status).toBe(400)
    expectNoWrites()
  })
})
