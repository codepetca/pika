import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  drainCodePetPalOutbox,
  enqueueCodePetPalEvent,
  lookupCodePetPalWorld,
} from '@/lib/codepetpal'

describe('CodePetPal integration helpers', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.SESSION_SECRET = 'test-session-secret-with-enough-entropy'
    process.env.CODEPETPAL_API_URL = 'https://codepetpal.example'
    process.env.CODEPETPAL_API_KEY = 'codepetpal-key'
    vi.restoreAllMocks()
  })

  it('queues enabled classroom events with pseudonymous idempotency keys', async () => {
    const upsert = vi.fn(async () => ({ error: null }))
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'classrooms') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { codepetpal_enabled: true },
                  error: null,
                })),
              })),
            })),
          }
        }
        if (table === 'integration_event_outbox') {
          return { upsert }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    }

    const result = await enqueueCodePetPalEvent(supabase as any, {
      classroomId: 'classroom-raw-id',
      studentId: 'student-raw-id',
      eventType: 'daily_entry_created',
      sourceId: 'entry-raw-id',
      occurredAt: '2026-05-07T12:00:00.000Z',
      payload: { date: '2026-05-07' },
    })

    expect(result.queued).toBe(true)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      classroom_id: 'classroom-raw-id',
      student_id: 'student-raw-id',
      event_type: 'daily_entry_created',
      occurred_at: '2026-05-07T12:00:00.000Z',
      payload: { date: '2026-05-07' },
    }), { onConflict: 'idempotency_key', ignoreDuplicates: true })

    const queued = upsert.mock.calls[0][0]
    expect(queued.idempotency_key).toMatch(/^pika:daily_entry_created:[a-f0-9]{32}$/)
    expect(queued.idempotency_key).not.toContain('entry-raw-id')
  })

  it('does not queue when the classroom has not opted in', async () => {
    const upsert = vi.fn()
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'classrooms') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { codepetpal_enabled: false },
                  error: null,
                })),
              })),
            })),
          }
        }
        return { upsert }
      }),
    }

    const result = await enqueueCodePetPalEvent(supabase as any, {
      classroomId: 'classroom-raw-id',
      studentId: 'student-raw-id',
      eventType: 'assignment_submitted',
      sourceId: 'doc-raw-id',
    })

    expect(result).toEqual({ queued: false, reason: 'disabled' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('drains due outbox rows without sending raw IDs to CodePetPal', async () => {
    const updates: Array<Record<string, unknown>> = []
    const rows = [
      {
        id: 'outbox-1',
        classroom_id: 'classroom-raw-id',
        student_id: 'student-raw-id',
        event_type: 'assignment_submitted',
        idempotency_key: 'pika:assignment_submitted:pseudonymous-key',
        occurred_at: '2026-05-07T12:00:00.000Z',
        payload: { source: 'pika' },
        attempt_count: 0,
      },
    ]
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(() => ({
              lte: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(async () => ({ data: rows, error: null })),
                })),
              })),
            })),
          })),
        })),
        update: vi.fn((payload: Record<string, unknown>) => ({
          eq: vi.fn(async () => {
            updates.push(payload)
            return { error: null }
          }),
        })),
      })),
    }
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      expect(JSON.stringify(body)).not.toContain('student-raw-id')
      expect(JSON.stringify(body)).not.toContain('classroom-raw-id')
      expect(body.events[0]).toMatchObject({
        idempotency_key: 'pika:assignment_submitted:pseudonymous-key',
        type: 'assignment_submitted',
        payload: { source: 'pika' },
      })
      expect(body.events[0].external_student_id).toMatch(/^pika_student_[a-f0-9]{32}$/)
      expect(body.events[0].external_classroom_id).toMatch(/^pika_classroom_[a-f0-9]{32}$/)
      return Response.json({
        failed: 0,
        results: [{ idempotency_key: 'pika:assignment_submitted:pseudonymous-key', status: 'processed' }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await drainCodePetPalOutbox(supabase as any)

    expect(result).toMatchObject({ ok: true, selected: 1, sent: 1, failed: 0 })
    expect(updates[0]).toMatchObject({ status: 'sent', attempt_count: 1, last_error: null })
  })

  it('keeps outbox rows retryable when CodePetPal omits per-event results', async () => {
    const updates: Array<Record<string, unknown>> = []
    const rows = [
      {
        id: 'outbox-1',
        classroom_id: 'classroom-raw-id',
        student_id: 'student-raw-id',
        event_type: 'daily_entry_created',
        idempotency_key: 'pika:daily_entry_created:pseudonymous-key',
        occurred_at: '2026-05-07T12:00:00.000Z',
        payload: { source: 'pika' },
        attempt_count: 0,
      },
    ]
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(() => ({
              lte: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(async () => ({ data: rows, error: null })),
                })),
              })),
            })),
          })),
        })),
        update: vi.fn((payload: Record<string, unknown>) => ({
          eq: vi.fn(async () => {
            updates.push(payload)
            return { error: null }
          }),
        })),
      })),
    }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ failed: 0, results: [] })))

    const result = await drainCodePetPalOutbox(supabase as any)

    expect(result).toMatchObject({ ok: false, selected: 1, sent: 0, failed: 1 })
    expect(updates[0]).toMatchObject({
      status: 'failed',
      attempt_count: 1,
      last_error: 'CodePetPal response omitted this event result',
    })
  })

  it('looks up worlds with pseudonymous IDs only', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      expect(JSON.stringify(body)).not.toContain('student-raw-id')
      expect(JSON.stringify(body)).not.toContain('classroom-raw-id')
      expect(body.external_student_id).toMatch(/^pika_student_[a-f0-9]{32}$/)
      expect(body.external_classroom_id).toMatch(/^pika_classroom_[a-f0-9]{32}$/)
      return Response.json({ enabled: true, world: { level: 1 } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await lookupCodePetPalWorld({
      classroomId: 'classroom-raw-id',
      studentId: 'student-raw-id',
    })

    expect(result.enabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('https://codepetpal.example/api/v1/worlds/lookup', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer codepetpal-key' }),
    }))
  })
})
