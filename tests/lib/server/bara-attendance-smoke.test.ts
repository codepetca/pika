import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  receiveBaraAttendanceSmokeCallback,
  runBaraAttendanceSmoke,
} from '@/lib/server/bara-attendance-smoke'
import {
  createV1RequestSignature,
  sha256Hex,
  verifyV1RequestSignature,
} from '@/vendor/attendance-contract/v1/signing'

const teacherId = '10000000-0000-4000-8000-000000000001'
const classroomId = '20000000-0000-4000-8000-000000000002'
const installationRef = 'pika_smoke_installation'
const tenantRef = 'tenant_codepet_labs'
const integrationSecret = 'pika-to-bara-smoke-secret-at-least-32-characters'
const eventSecret = 'bara-to-pika-smoke-secret-at-least-32-characters'
const now = Date.parse('2026-08-22T12:00:00Z')

function supabaseMock(consumeData: unknown = true) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({
      data: { teacher_id: teacherId, archived_at: null },
      error: null,
    })),
  }
  const rpc = vi.fn(async (name: string) => {
    if (name === 'begin_attendance_integration_smoke_v1') {
      return { data: { accepted: true }, error: null }
    }
    if (name === 'complete_attendance_integration_smoke_v1') {
      return { data: true, error: null }
    }
    if (name === 'consume_attendance_integration_smoke_nonce_v1') {
      return { data: consumeData, error: null }
    }
    throw new Error(`unexpected rpc ${name}`)
  })
  return { from: vi.fn(() => chain), rpc }
}

async function scopeRef() {
  return `scope_${await sha256Hex([
    installationRef,
    tenantRef,
    teacherId,
    classroomId,
  ].join('\n'))}`
}

describe('deployed Pika–Bara attendance authentication smoke', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'false')
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID', teacherId)
    vi.stubEnv('PIKA_BARA_ATTENDANCE_CANARY_CLASSROOM_ID', classroomId)
    vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL', 'https://bara.example.test/')
    vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF', installationRef)
    vi.stubEnv('BARA_ATTENDANCE_TENANT_REF', tenantRef)
    vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET', integrationSecret)
    vi.stubEnv('BARA_ATTENDANCE_EVENT_SECRET', eventSecret)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('proves deployed Pika-to-Bara and Bara-to-Pika auth while attendance is disabled', async () => {
    const supabase = supabaseMock()
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(url.toString()).toBe('https://bara.example.test/api/integrations/pika/v1/smoke')
      expect(init?.redirect).toBe('error')
      const headers = new Headers(init?.headers)
      expect(JSON.parse(String(init?.body))).toMatchObject({ rollout_mode: 'pre-enable' })
      await expect(verifyV1RequestSignature({
        secret: integrationSecret,
        method: 'POST',
        path: '/api/integrations/pika/v1/smoke',
        timestamp: headers.get('X-Attendance-Timestamp') ?? '',
        nonce: headers.get('X-Attendance-Nonce') ?? '',
        body: String(init?.body),
      }, headers.get('X-Attendance-Signature'))).resolves.toBe(true)
      return new Response(JSON.stringify({
        ok: true,
        checks: { pika_to_bara: true, bara_to_pika: true },
      }), { status: 200 })
    })

    await expect(runBaraAttendanceSmoke({
      attendanceMode: 'pre-enable',
      supabase: supabase as never,
      fetcher,
      now: () => now,
      randomId: () => '0123456789abcdef0123456789abcdef',
    })).resolves.toEqual({
      status: 'passed',
      checks: { canaryScope: true, pikaToBara: true, baraToPika: true },
    })
    expect(supabase.rpc.mock.calls.map(([name]) => name)).toEqual([
      'begin_attendance_integration_smoke_v1',
      'complete_attendance_integration_smoke_v1',
    ])
    expect(supabase.rpc).toHaveBeenCalledWith(
      'begin_attendance_integration_smoke_v1',
      expect.objectContaining({
        p_challenge_hash: await sha256Hex('smoke_0123456789abcdef0123456789abcdef'),
      }),
    )
  })

  it('skips preview without touching the production database or network', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const supabase = supabaseMock()
    const fetcher = vi.fn()
    await expect(runBaraAttendanceSmoke({
      attendanceMode: 'pre-enable',
      supabase: supabase as never,
      fetcher,
    })).resolves.toMatchObject({ status: 'skipped', reason: 'production_only' })
    expect(supabase.from).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a Preview reverse callback before configuration or database access', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const supabase = supabaseMock()

    await expect(receiveBaraAttendanceSmokeCallback(
      new Request('https://pika-preview.example/api/integrations/attendance/v1/smoke/events', {
        method: 'POST',
      }),
      { supabase: supabase as never },
    )).resolves.toEqual({ ok: false, status: 404, error: 'not_found' })
    expect(supabase.from).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('authenticates the reverse callback, binds the exact canary, and consumes its nonce', async () => {
    const timestamp = String(Math.floor(now / 1_000))
    const nonce = 'nonce_0123456789abcdef0123456789abcdef'
    const body = JSON.stringify({
      schema_version: 1,
      kind: 'attendance.auth.smoke.callback',
      installation_ref: installationRef,
      scope_ref: await scopeRef(),
      challenge: 'smoke_0123456789abcdef0123456789abcdef',
      rollout_mode: 'pre-enable',
    })
    const signature = await createV1RequestSignature({
      secret: eventSecret,
      method: 'POST',
      path: '/api/integrations/attendance/v1/smoke/events',
      timestamp,
      nonce,
      body,
    })
    const request = new Request(
      'https://pika.example.test/api/integrations/attendance/v1/smoke/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Attendance-Installation-Ref': installationRef,
          'X-Attendance-Timestamp': timestamp,
          'X-Attendance-Nonce': nonce,
          'X-Attendance-Signature': signature,
        },
        body,
      },
    )
    const supabase = supabaseMock()
    await expect(receiveBaraAttendanceSmokeCallback(request, {
      supabase: supabase as never,
      now: () => now,
    })).resolves.toEqual({ ok: true, status: 200 })
    expect(supabase.rpc).toHaveBeenCalledWith(
      'consume_attendance_integration_smoke_nonce_v1',
      expect.objectContaining({
        p_teacher_id: teacherId,
        p_classroom_id: classroomId,
        p_direction: 'bara_to_pika',
        p_nonce: nonce,
        p_challenge_hash: await sha256Hex('smoke_0123456789abcdef0123456789abcdef'),
      }),
    )
  })

  it('rejects a reverse secret mismatch before database access and rejects replay', async () => {
    const timestamp = String(Math.floor(now / 1_000))
    const nonce = 'nonce_0123456789abcdef0123456789abcdef'
    const body = JSON.stringify({
      schema_version: 1,
      kind: 'attendance.auth.smoke.callback',
      installation_ref: installationRef,
      scope_ref: await scopeRef(),
      challenge: 'smoke_0123456789abcdef0123456789abcdef',
      rollout_mode: 'pre-enable',
    })
    const requestWithSignature = async (secret: string) => new Request(
      'https://pika.example.test/api/integrations/attendance/v1/smoke/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Attendance-Installation-Ref': installationRef,
          'X-Attendance-Timestamp': timestamp,
          'X-Attendance-Nonce': nonce,
          'X-Attendance-Signature': await createV1RequestSignature({
            secret,
            method: 'POST',
            path: '/api/integrations/attendance/v1/smoke/events',
            timestamp,
            nonce,
            body,
          }),
        },
        body,
      },
    )
    const mismatchSupabase = supabaseMock()
    await expect(receiveBaraAttendanceSmokeCallback(
      await requestWithSignature('wrong-secret-that-is-at-least-32-characters'),
      { supabase: mismatchSupabase as never, now: () => now },
    )).resolves.toEqual({ ok: false, status: 401, error: 'invalid_authentication' })
    expect(mismatchSupabase.from).not.toHaveBeenCalled()
    expect(mismatchSupabase.rpc).not.toHaveBeenCalled()

    const replaySupabase = supabaseMock(false)
    await expect(receiveBaraAttendanceSmokeCallback(
      await requestWithSignature(eventSecret),
      { supabase: replaySupabase as never, now: () => now },
    )).resolves.toEqual({ ok: false, status: 409, error: 'replayed_request' })
  })

  it.each([
    { deployedFlag: 'false', callbackMode: 'enabled' },
    { deployedFlag: 'true', callbackMode: 'pre-enable' },
  ])('rejects a $callbackMode callback when Pika is $deployedFlag before database access', async ({
    deployedFlag,
    callbackMode,
  }) => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', deployedFlag)
    const timestamp = String(Math.floor(now / 1_000))
    const nonce = 'nonce_mode_mismatch_0123456789abcdef'
    const body = JSON.stringify({
      schema_version: 1,
      kind: 'attendance.auth.smoke.callback',
      installation_ref: installationRef,
      scope_ref: await scopeRef(),
      challenge: 'smoke_0123456789abcdef0123456789abcdef',
      rollout_mode: callbackMode,
    })
    const request = new Request(
      'https://pika.example.test/api/integrations/attendance/v1/smoke/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Attendance-Installation-Ref': installationRef,
          'X-Attendance-Timestamp': timestamp,
          'X-Attendance-Nonce': nonce,
          'X-Attendance-Signature': await createV1RequestSignature({
            secret: eventSecret,
            method: 'POST',
            path: '/api/integrations/attendance/v1/smoke/events',
            timestamp,
            nonce,
            body,
          }),
        },
        body,
      },
    )
    const supabase = supabaseMock()

    await expect(receiveBaraAttendanceSmokeCallback(request, {
      supabase: supabase as never,
      now: () => now,
    })).resolves.toEqual({ ok: false, status: 503, error: 'rollout_mode_mismatch' })
    expect(supabase.from).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})
