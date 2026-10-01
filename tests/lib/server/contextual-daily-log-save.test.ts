import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  saveContextualDailyLog,
  verifyContextualDailyLogPatchPreimage,
  verifyContextualDailyLogPostPreimage,
} from '@/lib/server/contextual-daily-log-save'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const entryId = '33333333-3333-4333-8333-333333333333'
const date = '2026-09-19'
const content = { type: 'doc', content: [] }

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: entryId,
    student_id: actorId,
    classroom_id: classroomId,
    date,
    text: 'Saved log',
    rich_content: content,
    minutes_reported: null,
    mood: null,
    on_time: true,
    version: 3,
    created_at: '2026-09-19T12:00:00.000Z',
    updated_at: '2026-09-19T12:00:00.000Z',
    ...overrides,
  }
}

function save(rpc: ReturnType<typeof vi.fn>, overrides: Record<string, unknown> = {}) {
  return saveContextualDailyLog({
    supabase: { rpc },
    actorId,
    classroomId,
    date,
    text: 'Saved log',
    richContent: content,
    onTime: true,
    palEvent: null,
    expectedVersion: 2,
    expectedEntryId: entryId,
    ...overrides,
  })
}

describe('contextual daily-log save', () => {
  const rpc = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockResolvedValue({ data: { ok: true, created: false, entry: entry() }, error: null })
  })

  it('binds the authenticated actor, classroom, date, revision and entry preimage to the RPC', async () => {
    await expect(save(rpc)).resolves.toMatchObject({ ok: true, entry: { id: entryId } })
    expect(rpc).toHaveBeenCalledWith('save_daily_log_for_member_v1', {
      p_actor_id: actorId,
      p_classroom_id: classroomId,
      p_date: date,
      p_text: 'Saved log',
      p_rich_content: content,
      p_on_time: true,
      p_expected_version: 2,
      p_expected_entry_id: entryId,
    })
  })

  it('omits nullable default RPC arguments for create-only saves', async () => {
    await save(rpc, { expectedVersion: null, expectedEntryId: null })
    expect(rpc).toHaveBeenCalledWith('save_daily_log_for_member_v1', {
      p_actor_id: actorId,
      p_classroom_id: classroomId,
      p_date: date,
      p_text: 'Saved log',
      p_rich_content: content,
      p_on_time: true,
    })
  })

  it('keeps the structured conflict contract after verifying its own entry', async () => {
    rpc.mockResolvedValue({
      data: { ok: false, status: 409, error: 'Entry has been updated elsewhere', entry: entry() },
      error: null,
    })
    await expect(save(rpc)).resolves.toEqual({
      ok: false, status: 409, error: 'Entry has been updated elsewhere', entry: entry(),
    })
  })

  it('allows a same-scope replacement entry in a verified conflict response', async () => {
    const replacementId = '44444444-4444-4444-8444-444444444444'
    rpc.mockResolvedValue({
      data: {
        ok: false,
        status: 409,
        error: 'Entry has been updated elsewhere',
        entry: entry({ id: replacementId }),
      },
      error: null,
    })
    await expect(save(rpc)).resolves.toMatchObject({ ok: false, entry: { id: replacementId } })
  })

  it.each([
    ['42501', 403],
    ['P0002', 404],
    ['22023', 400],
    ['40001', 409],
    ['PT409', 409],
    ['55P03', 409],
    ['PGRST202', 503],
    ['42883', 503],
    ['08006', 503],
  ])('maps RPC %s to %i without exposing database messages', async (code, statusCode) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private database detail' } })
    const operation = save(rpc)
    await expect(operation).rejects.toMatchObject({ statusCode })
    await expect(operation).rejects.not.toThrow('private database detail')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it.each([
    null,
    { ok: true, created: false, entry: entry({ student_id: entryId }) },
    { ok: true, created: false, entry: entry({ classroom_id: entryId }) },
    { ok: true, created: false, entry: entry({ date: '2026-09-20' }) },
    { ok: true, created: false, entry: entry({ id: actorId }) },
    { ok: true, created: false, entry: entry({ version: 0 }) },
    { ok: false, status: 409, error: 'Entry has been updated elsewhere', entry: entry({ id: 'not-a-uuid' }) },
    { ok: false, status: 409, error: 'Entry has been updated elsewhere', entry: { id: entryId } },
    { ok: true, created: false, entry: entry(), unexpected: true },
  ])('fails closed on malformed or cross-bound RPC results %#', async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(save(rpc)).rejects.toMatchObject({ statusCode: 503 })
  })

  it('rejects invalid trusted context before invoking the RPC', async () => {
    await expect(save(rpc, { actorId: 'not-a-uuid' })).rejects.toMatchObject({ statusCode: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accepts only a contextual POST preimage bound to the actor, classroom, date and usable version', () => {
    expect(verifyContextualDailyLogPostPreimage({
      actorId,
      classroomId,
      date,
      entry: {
        id: entryId,
        student_id: actorId,
        classroom_id: classroomId,
        date,
        version: 2,
        minutes_reported: null,
        mood: null,
      },
    })).toMatchObject({ id: entryId, version: 2 })
  })

  it.each([
    { id: entryId, student_id: entryId, classroom_id: classroomId, date, version: 2, minutes_reported: null, mood: null },
    { id: entryId, student_id: actorId, classroom_id: entryId, date, version: 2, minutes_reported: null, mood: null },
    { id: entryId, student_id: actorId, classroom_id: classroomId, date: '2026-09-20', version: 2, minutes_reported: null, mood: null },
    { id: entryId, student_id: actorId, classroom_id: classroomId, date, version: 0, minutes_reported: null, mood: null },
  ])('fails closed on a substituted contextual POST preimage %#', (preimage) => {
    expect(() => verifyContextualDailyLogPostPreimage({ actorId, classroomId, date, entry: preimage }))
      .toThrow(expect.objectContaining({ statusCode: 503 }))
  })

  it('fails closed on a malformed contextual PATCH preimage before it can be returned', () => {
    expect(() => verifyContextualDailyLogPatchPreimage({
      actorId,
      classroomId,
      date,
      entry: entry({ rich_content: 'not-a-document' }),
    })).toThrow(expect.objectContaining({ statusCode: 503 }))
  })
})
