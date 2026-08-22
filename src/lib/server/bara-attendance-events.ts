import { getServiceRoleClient } from '@/lib/supabase'
import { verifyV1RequestSignature } from '@/vendor/attendance-contract/v1/signing'
import { validateV1Event } from '@/vendor/attendance-contract/v1/validate'
import {
  assertBaraAttendanceCanaryClassroomOwner,
  BaraAttendanceCanaryError,
  getBaraAttendanceCanaryScope,
} from '@/lib/server/bara-attendance-canary'

const EVENT_PATH = '/api/integrations/attendance/v1/events'
const MAX_BODY_BYTES = 64_000
const MAX_CLOCK_SKEW_SECONDS = 5 * 60

interface AttendanceEventRpcClient {
  rpc(
    name: 'apply_attendance_event_for_classroom_v1',
    args: {
      p_event: unknown
      p_transport_nonce: string
      p_teacher_id: string
      p_classroom_id: string
    },
  ): Promise<{
    data: unknown
    error: { code?: string; message?: string } | null
  }>
}

type IngressResult =
  | { ok: true; status: 200; value: { accepted: true; duplicate: boolean; projection_applied: boolean } }
  | { ok: false; status: number; error: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function configuration() {
  const scope = getBaraAttendanceCanaryScope()
  if (scope.state !== 'ready' || !scope.teacherId || !scope.classroomId) return null
  const installationRef = process.env.BARA_ATTENDANCE_INSTALLATION_REF?.trim() ?? ''
  const secret = process.env.BARA_ATTENDANCE_EVENT_SECRET ?? ''
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(installationRef) || secret.length < 32) {
    throw new Error('Attendance event ingress is not configured')
  }
  return {
    installationRef,
    secret,
    teacherId: scope.teacherId,
    classroomId: scope.classroomId,
  }
}

export async function receiveBaraAttendanceEvent(request: Request): Promise<IngressResult> {
  const config = configuration()
  if (!config) {
    return { ok: false, status: 503, error: 'temporarily_unavailable' }
  }

  const url = new URL(request.url)
  if (
    request.method !== 'POST' ||
    url.pathname !== EVENT_PATH ||
    url.search ||
    !request.headers.get('content-type')?.toLocaleLowerCase().startsWith('application/json')
  ) {
    return { ok: false, status: 400, error: 'invalid_request' }
  }

  const installationRef = request.headers.get('x-attendance-installation-ref')?.trim() ?? ''
  const timestamp = request.headers.get('x-attendance-timestamp')?.trim() ?? ''
  const nonce = request.headers.get('x-attendance-nonce')?.trim() ?? ''
  const signature = request.headers.get('x-attendance-signature')?.trim() ?? ''
  const timestampSeconds = /^\d{10}$/.test(timestamp) ? Number(timestamp) : Number.NaN
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (
    installationRef !== config.installationRef ||
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS ||
    !/^[A-Za-z0-9._~-]{16,128}$/.test(nonce)
  ) {
    return { ok: false, status: 401, error: 'invalid_authentication' }
  }

  const body = await request.text()
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: 'payload_too_large' }
  }
  const signatureValid = await verifyV1RequestSignature({
    secret: config.secret,
    method: 'POST',
    path: EVENT_PATH,
    timestamp,
    nonce,
    body,
  }, signature)
  if (!signatureValid) {
    return { ok: false, status: 401, error: 'invalid_authentication' }
  }

  let input: unknown
  try {
    input = JSON.parse(body)
  } catch {
    return { ok: false, status: 400, error: 'invalid_json' }
  }
  const validation = validateV1Event(input)
  if (!validation.ok) return { ok: false, status: 422, error: validation.error }
  if (validation.value.installation_ref !== installationRef) {
    return { ok: false, status: 422, error: 'resource_mismatch' }
  }

  const serviceClient = getServiceRoleClient()
  try {
    await assertBaraAttendanceCanaryClassroomOwner({
      supabase: serviceClient,
      classroomId: config.classroomId,
    })
  } catch (error) {
    if (error instanceof BaraAttendanceCanaryError) {
      return { ok: false, status: 503, error: 'temporarily_unavailable' }
    }
    throw error
  }
  const client = serviceClient as unknown as AttendanceEventRpcClient
  const { data, error } = await client.rpc('apply_attendance_event_for_classroom_v1', {
    p_event: validation.value,
    p_transport_nonce: nonce,
    p_teacher_id: config.teacherId,
    p_classroom_id: config.classroomId,
  })
  if (error) {
    if (error.code === '23505') return { ok: false, status: 409, error: 'replay_conflict' }
    if (error.code === '22023') return { ok: false, status: 422, error: 'invalid_payload' }
    if (error.code === '23514') return { ok: false, status: 422, error: 'resource_mismatch' }
    throw new Error('Attendance event could not be persisted')
  }
  if (
    !isPlainObject(data) ||
    data.accepted !== true ||
    typeof data.duplicate !== 'boolean' ||
    typeof data.projection_applied !== 'boolean' ||
    Object.keys(data).some((key) => !['accepted', 'duplicate', 'projection_applied'].includes(key))
  ) {
    throw new Error('Attendance event persistence returned an invalid result')
  }

  return {
    ok: true,
    status: 200,
    value: {
      accepted: true,
      duplicate: data.duplicate,
      projection_applied: data.projection_applied,
    },
  }
}
