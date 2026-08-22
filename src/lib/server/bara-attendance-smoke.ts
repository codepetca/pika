import { z } from 'zod'

import { getServiceRoleClient } from '@/lib/supabase'
import {
  assertConfiguredBaraAttendanceCanaryClassroomOwner,
  getConfiguredBaraAttendanceCanaryScope,
} from '@/lib/server/bara-attendance-canary'
import {
  createV1RequestSignature,
  sha256Hex,
  verifyV1RequestSignature,
} from '@/vendor/attendance-contract/v1/signing'

const BARA_SMOKE_PATH = '/api/integrations/pika/v1/smoke'
const PIKA_SMOKE_CALLBACK_PATH = '/api/integrations/attendance/v1/smoke/events'
const MAX_CLOCK_SKEW_SECONDS = 5 * 60
const MAX_BODY_BYTES = 2_048

const smokeRequestSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal('attendance.auth.smoke.request'),
  installation_ref: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/),
  scope_ref: z.string().regex(/^scope_[a-f0-9]{64}$/),
  challenge: z.string().regex(/^smoke_[a-f0-9]{32}$/),
  rollout_mode: z.enum(['pre-enable', 'enabled']),
}).strict()

const smokeCallbackSchema = smokeRequestSchema.extend({
  kind: z.literal('attendance.auth.smoke.callback'),
}).strict()

const baraSmokeResponseSchema = z.object({
  ok: z.literal(true),
  checks: z.object({
    pika_to_bara: z.literal(true),
    bara_to_pika: z.literal(true),
  }).strict(),
}).strict()

interface SmokeRpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{
    data: unknown
    error: { code?: string; message?: string } | null
  }>
}

export type AttendanceSmokeResult = {
  status: 'passed' | 'failed' | 'skipped'
  checks: {
    canaryScope: boolean
    pikaToBara: boolean
    baraToPika: boolean
  }
  reason?: 'production_only' | 'not_configured' | 'rate_limited' | 'remote_rejected' | 'audit_failed'
}

function exactBaseUrl(raw: string) {
  const url = new URL(raw)
  const localHttp = url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  if (
    (url.protocol !== 'https:' && !localHttp)
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) throw new Error('invalid_url')
  return url.origin
}

function smokeConfiguration() {
  const scope = getConfiguredBaraAttendanceCanaryScope()
  const installationRef = process.env.BARA_ATTENDANCE_INSTALLATION_REF?.trim() ?? ''
  const tenantRef = process.env.BARA_ATTENDANCE_TENANT_REF?.trim() ?? ''
  const integrationSecret = process.env.BARA_ATTENDANCE_INTEGRATION_SECRET ?? ''
  const eventSecret = process.env.BARA_ATTENDANCE_EVENT_SECRET ?? ''
  if (
    scope.state !== 'ready'
    || !scope.teacherId
    || !scope.classroomId
    || !/^[A-Za-z0-9._~-]{1,128}$/.test(installationRef)
    || !/^[A-Za-z0-9._~-]{1,128}$/.test(tenantRef)
    || integrationSecret.length < 32
    || eventSecret.length < 32
    || integrationSecret === eventSecret
  ) throw new Error('not_configured')
  let baraOrigin: string
  try {
    baraOrigin = exactBaseUrl(process.env.BARA_ATTENDANCE_API_BASE_URL?.trim() ?? '')
  } catch {
    throw new Error('not_configured')
  }
  return {
    ...scope,
    teacherId: scope.teacherId,
    classroomId: scope.classroomId,
    installationRef,
    tenantRef,
    integrationSecret,
    eventSecret,
    baraOrigin,
  }
}

async function configuredScopeRef(config: ReturnType<typeof smokeConfiguration>) {
  return `scope_${await sha256Hex([
    config.installationRef,
    config.tenantRef,
    config.teacherId,
    config.classroomId,
  ].join('\n'))}`
}

function failure(reason: AttendanceSmokeResult['reason'], checks?: Partial<AttendanceSmokeResult['checks']>): AttendanceSmokeResult {
  return {
    status: 'failed',
    reason,
    checks: {
      canaryScope: checks?.canaryScope ?? false,
      pikaToBara: checks?.pikaToBara ?? false,
      baraToPika: checks?.baraToPika ?? false,
    },
  }
}

export async function runBaraAttendanceSmoke(input: {
  attendanceMode: 'pre-enable' | 'enabled'
  supabase?: SmokeRpcClient
  fetcher?: typeof fetch
  now?: () => number
  randomId?: () => string
}): Promise<AttendanceSmokeResult> {
  if (process.env.VERCEL_ENV !== 'production') {
    return {
      status: 'skipped',
      reason: 'production_only',
      checks: { canaryScope: false, pikaToBara: false, baraToPika: false },
    }
  }

  let config: ReturnType<typeof smokeConfiguration>
  try {
    config = smokeConfiguration()
  } catch {
    return failure('not_configured')
  }
  const supabase = input.supabase ?? getServiceRoleClient() as unknown as SmokeRpcClient
  try {
    await assertConfiguredBaraAttendanceCanaryClassroomOwner({
      supabase,
      classroomId: config.classroomId,
    })
  } catch {
    return failure('not_configured')
  }

  const now = input.now?.() ?? Date.now()
  const random = (input.randomId?.() ?? crypto.randomUUID().replaceAll('-', '')).toLowerCase()
  const requestId = `smoke_request_${random}`
  const challenge = `smoke_${random.slice(0, 32)}`
  const challengeHash = await sha256Hex(challenge)
  const scopeRef = await configuredScopeRef(config)
  const begin = await supabase.rpc('begin_attendance_integration_smoke_v1', {
    p_installation_ref: config.installationRef,
    p_teacher_id: config.teacherId,
    p_classroom_id: config.classroomId,
    p_request_id: requestId,
    p_challenge_hash: challengeHash,
  })
  if (begin.error) {
    return failure(
      begin.error.message?.includes('rate_limited') ? 'rate_limited' : 'not_configured',
    )
  }
  if (!z.object({ accepted: z.literal(true) }).passthrough().safeParse(begin.data).success) {
    return failure('rate_limited')
  }

  const payload = smokeRequestSchema.parse({
    schema_version: 1,
    kind: 'attendance.auth.smoke.request',
    installation_ref: config.installationRef,
    scope_ref: scopeRef,
    challenge,
    rollout_mode: input.attendanceMode,
  })
  const body = JSON.stringify(payload)
  const timestamp = String(Math.floor(now / 1_000))
  const nonce = `nonce_${random}`
  const signature = await createV1RequestSignature({
    secret: config.integrationSecret,
    method: 'POST',
    path: BARA_SMOKE_PATH,
    timestamp,
    nonce,
    body,
  })

  let pikaToBara = false
  let baraToPika = false
  try {
    const response = await (input.fetcher ?? fetch)(`${config.baraOrigin}${BARA_SMOKE_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Attendance-Installation-Ref': config.installationRef,
        'X-Attendance-Timestamp': timestamp,
        'X-Attendance-Nonce': nonce,
        'X-Attendance-Signature': signature,
      },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    const responseText = (await response.text()).slice(0, 4_096)
    const parsed = response.ok
      ? baraSmokeResponseSchema.safeParse(JSON.parse(responseText) as unknown)
      : null
    pikaToBara = Boolean(response.ok && parsed?.success)
    baraToPika = Boolean(parsed?.success && parsed.data.checks.bara_to_pika)
  } catch {
    pikaToBara = false
    baraToPika = false
  }

  const passed = pikaToBara && baraToPika
  const completed = await supabase.rpc('complete_attendance_integration_smoke_v1', {
    p_installation_ref: config.installationRef,
    p_teacher_id: config.teacherId,
    p_classroom_id: config.classroomId,
    p_request_id: requestId,
    p_passed: passed,
    p_pika_to_bara: pikaToBara,
    p_bara_to_pika: baraToPika,
    p_error_code: passed ? null : 'remote_rejected',
  })
  if (completed.error || completed.data !== true) {
    return failure('audit_failed', { canaryScope: true, pikaToBara, baraToPika })
  }
  return passed
    ? { status: 'passed', checks: { canaryScope: true, pikaToBara: true, baraToPika: true } }
    : failure('remote_rejected', { canaryScope: true, pikaToBara, baraToPika })
}

export async function receiveBaraAttendanceSmokeCallback(
  request: Request,
  input: { supabase?: SmokeRpcClient; now?: () => number } = {},
): Promise<{ ok: true; status: 200 } | { ok: false; status: number; error: string }> {
  if (process.env.VERCEL_ENV !== 'production') {
    return { ok: false, status: 404, error: 'not_found' }
  }
  let config: ReturnType<typeof smokeConfiguration>
  try {
    config = smokeConfiguration()
  } catch {
    return { ok: false, status: 503, error: 'temporarily_unavailable' }
  }
  const url = new URL(request.url)
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (request.method !== 'POST' || url.pathname !== PIKA_SMOKE_CALLBACK_PATH || url.search
    || !contentType.startsWith('application/json')) {
    return { ok: false, status: 400, error: 'invalid_request' }
  }
  const installationRef = request.headers.get('x-attendance-installation-ref')?.trim() ?? ''
  const timestamp = request.headers.get('x-attendance-timestamp')?.trim() ?? ''
  const nonce = request.headers.get('x-attendance-nonce')?.trim() ?? ''
  const signature = request.headers.get('x-attendance-signature')?.trim() ?? ''
  const timestampSeconds = /^\d{10}$/.test(timestamp) ? Number(timestamp) : Number.NaN
  const nowSeconds = Math.floor((input.now?.() ?? Date.now()) / 1_000)
  if (
    installationRef !== config.installationRef
    || !Number.isSafeInteger(timestampSeconds)
    || Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS
    || !/^[A-Za-z0-9._~-]{16,128}$/.test(nonce)
  ) return { ok: false, status: 401, error: 'invalid_authentication' }

  const body = await request.text()
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: 'payload_too_large' }
  }
  const signatureValid = await verifyV1RequestSignature({
    secret: config.eventSecret,
    method: 'POST',
    path: PIKA_SMOKE_CALLBACK_PATH,
    timestamp,
    nonce,
    body,
  }, signature)
  if (!signatureValid) return { ok: false, status: 401, error: 'invalid_authentication' }
  let payload: z.infer<typeof smokeCallbackSchema>
  try {
    payload = smokeCallbackSchema.parse(JSON.parse(body) as unknown)
  } catch {
    return { ok: false, status: 422, error: 'invalid_payload' }
  }
  if (
    payload.installation_ref !== config.installationRef
    || payload.scope_ref !== await configuredScopeRef(config)
  ) return { ok: false, status: 422, error: 'resource_mismatch' }

  const deployedMode = process.env.PIKA_BARA_ATTENDANCE_ENABLED === 'true'
    ? 'enabled'
    : process.env.PIKA_BARA_ATTENDANCE_ENABLED === 'false'
      ? 'pre-enable'
      : null
  if (payload.rollout_mode !== deployedMode) {
    return { ok: false, status: 503, error: 'rollout_mode_mismatch' }
  }

  const supabase = input.supabase ?? getServiceRoleClient() as unknown as SmokeRpcClient
  try {
    await assertConfiguredBaraAttendanceCanaryClassroomOwner({
      supabase,
      classroomId: config.classroomId,
    })
  } catch {
    return { ok: false, status: 503, error: 'temporarily_unavailable' }
  }
  const consumed = await supabase.rpc('consume_attendance_integration_smoke_nonce_v1', {
    p_installation_ref: config.installationRef,
    p_teacher_id: config.teacherId,
    p_classroom_id: config.classroomId,
    p_direction: 'bara_to_pika',
    p_nonce: nonce,
    p_request_timestamp: new Date(timestampSeconds * 1_000).toISOString(),
    p_challenge_hash: await sha256Hex(payload.challenge),
  })
  if (consumed.error) return { ok: false, status: 503, error: 'temporarily_unavailable' }
  if (consumed.data !== true) return { ok: false, status: 409, error: 'replayed_request' }
  return { ok: true, status: 200 }
}
