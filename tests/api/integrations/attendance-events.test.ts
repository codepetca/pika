import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createV1RequestSignature } from '@/vendor/attendance-contract/v1/signing'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => ({ rpc: mocks.rpc }),
}))

import { POST } from '@/app/api/integrations/attendance/v1/events/route'

const path = '/api/integrations/attendance/v1/events'
const secret = 'test-attendance-event-secret-with-at-least-32-characters'
const teacherId = '10000000-0000-4000-8000-000000000001'
const classroomId = '20000000-0000-4000-8000-000000000002'
const event = {
  schema_version: 1,
  event_id: 'event_one',
  idempotency_key: 'event:one',
  correlation_ref: 'correlation_one',
  event_type: 'attendance.session.opened',
  occurred_at: '2026-08-16T14:05:00Z',
  installation_ref: 'pika_test_installation',
  roster_ref: 'roster_one',
  occurrence_ref: 'occurrence_one',
  session_revision: 2,
  metadata: { opened_at: '2026-08-16T14:05:00Z', trigger: 'schedule' },
}

async function request(
  body = JSON.stringify(event),
  signedBody = body,
  nonce = 'nonce_event_request_12345',
) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = await createV1RequestSignature({
    secret,
    method: 'POST',
    path,
    timestamp,
    nonce,
    body: signedBody,
  })
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Attendance-Installation-Ref': 'pika_test_installation',
      'X-Attendance-Timestamp': timestamp,
      'X-Attendance-Nonce': nonce,
      'X-Attendance-Signature': signature,
    },
    body,
  })
}

describe('POST /api/integrations/attendance/v1/events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'true')
    vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF', 'pika_test_installation')
    vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL', 'https://attendance-api.example')
    vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET', 'integration-secret-with-at-least-32-characters')
    vi.stubEnv('BARA_ATTENDANCE_EVENT_SECRET', secret)
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID', teacherId)
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_CLASSROOM_ID', classroomId)
    mocks.rpc.mockResolvedValue({
      data: { accepted: true, duplicate: false, projection_applied: true },
      error: null,
    })
  })

  afterEach(() => vi.unstubAllEnvs())

  it('persists a signed closed event through the atomic inbox RPC', async () => {
    const response = await POST(await request(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      duplicate: false,
      projection_applied: true,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('apply_attendance_event_for_classroom_v1', {
      p_event: event,
      p_transport_nonce: 'nonce_event_request_12345',
      p_teacher_id: teacherId,
      p_classroom_id: classroomId,
    })
  })

  it('rejects a tampered body before touching Supabase', async () => {
    const original = JSON.stringify(event)
    const tampered = JSON.stringify({ ...event, session_revision: 3 })
    const response = await POST(await request(tampered, original), { params: Promise.resolve({}) })

    expect(response.status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects extra PII fields before touching Supabase', async () => {
    const body = JSON.stringify({
      ...event,
      metadata: { ...event.metadata, student_name: 'Ada Lovelace' },
    })
    const response = await POST(await request(body), { params: Promise.resolve({}) })

    expect(response.status).toBe(422)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('returns a stable duplicate acknowledgement from the inbox', async () => {
    mocks.rpc.mockResolvedValue({
      data: { accepted: true, duplicate: true, projection_applied: false },
      error: null,
    })
    const response = await POST(await request(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ duplicate: true })
  })

  it('returns a closed resource mismatch for a cross-wired contract reference', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'database detail' },
    })

    const response = await POST(await request(), { params: Promise.resolve({}) })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'resource_mismatch' })
  })

  it('asks Bara to retry while event ingress is disabled', async () => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'false')
    const response = await POST(await request(), { params: Promise.resolve({}) })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'temporarily_unavailable' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
