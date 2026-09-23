import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST, PATCH } from '@/app/api/student/entries/route'
import { expectContentFreeDiagnostic, privateDiagnosticError } from '../../helpers/diagnostics'

const mocks = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), deliver: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => mocks }))
vi.mock('@/lib/auth', () => ({ requireRole: async () => ({ id: 'student-1', role: 'student' }) }))
vi.mock('@/lib/timezone', () => ({ getTodayInToronto: () => '2026-09-16', isOnTime: () => true }))
vi.mock('@/lib/server/classrooms', () => ({ assertStudentCanAccessClassroom: async () => ({ ok: true }) }))
vi.mock('@/lib/server/pal-outbox', () => ({ attemptImmediatePalEventDelivery: mocks.deliver }))

const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My daily reflection' }] }] }
const previousContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Earlier reflection' }] }] }
const saved = { id: 'entry-1', version: 2, text: 'My daily reflection', rich_content: content }

function setup(existing: boolean) {
  const write = { select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: saved, error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: saved, error: null }), eq: vi.fn().mockReturnThis() }
  const insert = vi.fn(() => write)
  const update = vi.fn(() => write)
  mocks.from.mockImplementation((table: string) => ({
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), insert, update,
    single: vi.fn().mockResolvedValue({ data: table === 'class_days' ? { is_class_day: true }
      : existing ? { ...saved, version: 1, text: 'Earlier reflection', rich_content: previousContent, minutes_reported: 20, mood: '🙂' } : null, error: null }),
  }))
  mocks.rpc.mockResolvedValue({ data: { ok: true, created: !existing, entry: saved }, error: null })
  return { insert, update, write }
}
function request(method: 'POST' | 'PATCH', version = 1) {
  return new NextRequest('http://localhost/api/student/entries', { method, body: JSON.stringify({
    classroom_id: 'classroom-1', date: '2026-09-16', entry_id: method === 'PATCH' ? 'entry-1' : undefined, version, rich_content: content,
  }) })
}
const cases = [ ['POST', false], ['POST', true], ['PATCH', false], ['PATCH', true] ] as const

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('PAL_ENABLED', 'true')
  vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
  vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
  vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')
  vi.stubEnv('PAL_CLASSROOM_ENABLED', 'false')
  mocks.deliver.mockResolvedValue('delivered')
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe.each(cases)('%s daily log (existing %s)', (method, existing) => {
  const handler = method === 'POST' ? POST : PATCH
  it.each([
    ['PAL_INTEGRATION_SECRET', ''],
    ['PAL_PSEUDONYM_SECRET', ''],
    ['PAL_PSEUDONYM_SECRET', 'short'],
    ['PAL_API_URL', 'https://pal.example.test/unsafe-path'],
  ])('saves with invalid %s configuration without calling Pal', async (key, value) => {
    const { insert, update } = setup(existing)
    vi.stubEnv(key, value)
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await handler(request(method))
    expect(response.status).toBe(200)
    expect((await response.json()).entry).toEqual(saved)
    expect(existing ? update : insert).toHaveBeenCalledOnce()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.deliver).not.toHaveBeenCalled()
    expectContentFreeDiagnostic(diagnostic.mock.calls, 'daily_log.pal_prepare', 'unexpected')
  })
  it.each([false, true])('returns the committed entry when immediate delivery throws (classroom %s)', async (classroom) => {
    vi.stubEnv('PAL_CLASSROOM_ENABLED', String(classroom))
    vi.stubEnv('PAL_MEMBERSHIP_IDENTITY_ENABLED', String(classroom))
    const { insert, update } = setup(existing)
    mocks.deliver.mockRejectedValueOnce(privateDiagnosticError)
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await handler(request(method))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ entry: saved, pal_delivery: 'pending' })
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenCalledWith('upsert_student_entry_with_pal_event_atomic', expect.objectContaining({
      p_pal_event: classroom ? null : expect.objectContaining({ event_type: 'daily_log.completed' }),
    }))
    expect(insert).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expectContentFreeDiagnostic(diagnostic.mock.calls, 'daily_log.pal_delivery')
  })
  it('does not retry a failed atomic save through the non-Pal write path', async () => {
    const { insert, update } = setup(existing)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '40001', message: 'Transaction failed' } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await handler(request(method))).status).toBe(500)
    expect(insert).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(mocks.deliver).not.toHaveBeenCalled()
  })
  it('preserves atomic version conflicts without delivery or a second write', async () => {
    const { insert, update } = setup(existing)
    mocks.rpc.mockResolvedValueOnce({ data: { ok: false, status: 409, error: 'Entry has been updated elsewhere', entry: saved }, error: null })
    expect((await handler(request(method))).status).toBe(409)
    expect(insert).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(mocks.deliver).not.toHaveBeenCalled()
  })
})

it('still rejects a stale PATCH before writing when Pal configuration is invalid', async () => {
  const { insert, update } = setup(true)
  vi.stubEnv('PAL_INTEGRATION_SECRET', '')
  expect((await PATCH(request('PATCH', 0))).status).toBe(409)
  expect(insert).not.toHaveBeenCalled()
  expect(update).not.toHaveBeenCalled()
  expect(mocks.rpc).not.toHaveBeenCalled()
})
