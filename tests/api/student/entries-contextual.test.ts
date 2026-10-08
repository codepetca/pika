import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { POST, PATCH } from '@/app/api/student/entries/route'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { authorizeContextualDailyLogRequest } from '@/lib/server/contextual-daily-log-access'
import { saveContextualDailyLog } from '@/lib/server/contextual-daily-log-save'
import { prepareDailyLogPal, deliverDailyLogPal } from '@/lib/server/daily-log-pal'
import { getServiceRoleClient } from '@/lib/supabase'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertStudentCanAccessClassroom: vi.fn() }))
vi.mock('@/lib/server/contextual-daily-log-access', () => ({ authorizeContextualDailyLogRequest: vi.fn() }))
vi.mock('@/lib/server/contextual-daily-log-save', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/contextual-daily-log-save')>(),
  saveContextualDailyLog: vi.fn(),
}))
vi.mock('@/lib/server/daily-log-pal', () => ({ prepareDailyLogPal: vi.fn(), deliverDailyLogPal: vi.fn() }))
vi.mock('@/lib/server/pal-config', () => ({ isClassroomPalRequested: vi.fn(() => false) }))

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const entryId = '33333333-3333-4333-8333-333333333333'
const date = '2024-10-15'
const content = { type: 'doc', content: [] }
const actor = { id: actorId, role: 'teacher' as const, email: 'enrolled-teacher@example.com' }

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: entryId,
    student_id: actorId,
    classroom_id: classroomId,
    date,
    text: '',
    rich_content: content,
    minutes_reported: null,
    mood: null,
    on_time: true,
    version: 2,
    created_at: '2024-10-15T12:00:00.000Z',
    updated_at: '2024-10-15T12:00:00.000Z',
    ...overrides,
  }
}

function postPreimage(overrides: Record<string, unknown> = {}) {
  return {
    id: entryId,
    student_id: actorId,
    classroom_id: classroomId,
    date,
    version: 2,
    minutes_reported: null,
    mood: null,
    ...overrides,
  }
}

function client(existing: unknown, existingError: unknown = null) {
  const classDay = {
    select: vi.fn(() => classDay),
    eq: vi.fn(() => classDay),
    single: vi.fn().mockResolvedValue({ data: { is_class_day: true }, error: null }),
  }
  const entries = {
    select: vi.fn(() => entries),
    eq: vi.fn(() => entries),
    single: vi.fn().mockResolvedValue({ data: existing, error: existingError }),
    insert: vi.fn(),
    update: vi.fn(),
  }
  return {
    from: vi.fn((table: string) => table === 'class_days' ? classDay : entries),
    rpc: vi.fn(),
    entries,
  }
}

function postRequest() {
  return new NextRequest('http://localhost/api/student/entries', {
    method: 'POST',
    body: JSON.stringify({ classroom_id: classroomId, date, rich_content: content }),
  })
}

function patchRequest(body: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/student/entries', {
    method: 'PATCH',
    body: JSON.stringify({
      classroom_id: classroomId,
      date,
      entry_id: entryId,
      version: 2,
      rich_content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated' }] }] },
      ...body,
    }),
  })
}

describe('contextual Daily Log writes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(authorizeContextualDailyLogRequest).mockResolvedValue({
      mode: 'contextual', user: actor, classroomId,
    })
    vi.mocked(prepareDailyLogPal).mockReturnValue({ enabled: false, event: null })
    vi.mocked(saveContextualDailyLog).mockResolvedValue({ ok: true, created: false, entry: entry() } as never)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('lets an admitted, enrolled global teacher save through the member transaction', async () => {
    const service = client(postPreimage())
    vi.mocked(getServiceRoleClient).mockReturnValue(service as never)

    const response = await POST(postRequest())
    expect(response.status).toBe(200)
    expect(saveContextualDailyLog).toHaveBeenCalledWith(expect.objectContaining({
      actorId, classroomId, expectedVersion: 2, expectedEntryId: entryId,
    }))
    expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
    expect(service.entries.update).not.toHaveBeenCalled()
    expect(service.entries.insert).not.toHaveBeenCalled()
  })

  it('keeps non-admitted saves on the unchanged legacy classroom guard', async () => {
    const service = client(null, { code: 'PGRST116' })
    vi.mocked(getServiceRoleClient).mockReturnValue(service as never)
    vi.mocked(authorizeContextualDailyLogRequest).mockResolvedValue({
      mode: 'legacy', user: { ...actor, role: 'student' }, classroomId,
    })
    vi.mocked(assertStudentCanAccessClassroom).mockResolvedValue({ ok: false, status: 403, error: 'Not enrolled in this classroom' })

    const response = await POST(postRequest())
    expect(response.status).toBe(403)
    expect(saveContextualDailyLog).not.toHaveBeenCalled()
    expect(assertStudentCanAccessClassroom).toHaveBeenCalledWith(actorId, classroomId)
  })

  it.each([
    ['Pal disabled', { enabled: false, event: null }],
    ['Pal enabled', { enabled: true, event: null }],
    ['Pal preparation failure', { enabled: false, event: null }],
  ])('always invokes the member RPC when %s', async (_label, pal) => {
    const service = client(null, { code: 'PGRST116' })
    vi.mocked(getServiceRoleClient).mockReturnValue(service as never)
    vi.mocked(prepareDailyLogPal).mockReturnValue(pal as never)

    const response = await POST(postRequest())
    expect(response.status).toBe(200)
    expect(saveContextualDailyLog).toHaveBeenCalledOnce()
    expect(service.entries.insert).not.toHaveBeenCalled()
    expect(service.entries.update).not.toHaveBeenCalled()
  })

  it('delivers Pal only after a committed contextual save', async () => {
    const service = client(null, { code: 'PGRST116' })
    vi.mocked(getServiceRoleClient).mockReturnValue(service as never)
    vi.mocked(prepareDailyLogPal).mockReturnValue({ enabled: true, event: { event_name: 'daily_log.completed' } } as never)
    vi.mocked(saveContextualDailyLog).mockRejectedValueOnce(new Error('transaction failed'))

    const response = await POST(postRequest())
    expect(response.status).toBe(500)
    expect(deliverDailyLogPal).not.toHaveBeenCalled()
  })

  it('returns verified member-transaction conflicts without direct writes', async () => {
    const service = client(postPreimage())
    vi.mocked(getServiceRoleClient).mockReturnValue(service as never)
    vi.mocked(saveContextualDailyLog).mockResolvedValue({
      ok: false, status: 409, error: 'Entry has been updated elsewhere', entry: entry(),
    } as never)

    const response = await POST(postRequest())
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: 'Entry has been updated elsewhere' })
    expect(service.entries.update).not.toHaveBeenCalled()
  })

  it('rejects a PATCH entry-id mismatch, including a missing preimage, before the RPC', async () => {
    const service = client(null, { code: 'PGRST116' })
    vi.mocked(getServiceRoleClient).mockReturnValue(service as never)

    const response = await PATCH(patchRequest())
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Entry has been updated elsewhere', entry: null })
    expect(saveContextualDailyLog).not.toHaveBeenCalled()
  })

  it('sends contextual no-op PATCHes through the member transaction', async () => {
    const service = client(entry())
    vi.mocked(getServiceRoleClient).mockReturnValue(service as never)

    const response = await PATCH(patchRequest({ rich_content: content }))
    expect(response.status).toBe(200)
    expect(saveContextualDailyLog).toHaveBeenCalledOnce()
    expect(service.entries.update).not.toHaveBeenCalled()
  })
})
