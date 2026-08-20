import { createV1RequestSignature } from '@/vendor/attendance-contract/v1/signing'
import type {
  V1AttendanceMarks,
  V1CheckInPresentationRequest,
  V1RosterSnapshot,
  V1ScheduleSnapshot,
  V1SessionCommand,
  V1SessionSnapshot,
  V1StudentCheckIn,
} from '@/vendor/attendance-contract/v1/types'
import { validateV1Message } from '@/vendor/attendance-contract/v1/validate'

type Fetcher = typeof fetch

export interface ClientOptions {
  fetcher?: Fetcher
  now?: () => number
  nonce?: () => string
}

export interface BaraRosterSnapshotResult {
  outcome: 'applied' | 'duplicate'
  rosterRef: string
  revision: number
  createdCount: number
  updatedCount: number
  deactivatedCount: number
}

export interface BaraScheduleSnapshotResult {
  outcome: 'applied' | 'duplicate'
  rosterRef: string
  revision: number
  scheduledCount: number
  updatedCount: number
  cancelledCount: number
  preservedCount: number
}

export interface BaraSessionCommandResult {
  outcome: 'applied' | 'duplicate' | 'unchanged'
  occurrenceRef: string
  status: 'open' | 'closed'
  sessionRevision: number
}

export interface BaraAttendanceMarksResult {
  outcome: 'applied' | 'duplicate'
  occurrenceRef: string
  sessionRevision: number
  appliedCount: number
  unchangedCount: number
}

export interface BaraCheckInPresentationResult {
  occurrenceRef: string
  sessionRevision: number
  checkInPath: string
  validUntil: string
}

export interface BaraStudentCheckInResult {
  outcome: 'applied' | 'duplicate' | 'rejected'
  resultCode:
    | 'present_marked'
    | 'already_present'
    | 'already_late'
    | 'review_needed'
    | 'not_on_roster'
    | 'session_closed'
    | 'invalid_check_in_token'
    | 'not_authorized'
  occurrenceRef: string
  sessionRevision: number
  record?: {
    participantRef: string
    recordRevision: number
    status: 'unmarked' | 'present' | 'late' | 'absent'
    modifiedAt: string
  }
}

export class BaraAttendanceClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'BaraAttendanceClientError'
  }
}

function configuration() {
  if (process.env.PIKA_BARA_ATTENDANCE_ENABLED !== 'true') {
    throw new BaraAttendanceClientError('Bara attendance integration is disabled', 'disabled', false)
  }

  const rawBaseUrl = process.env.BARA_ATTENDANCE_API_BASE_URL?.trim() ?? ''
  let baseUrl: URL
  try {
    baseUrl = new URL(rawBaseUrl)
  } catch {
    throw new BaraAttendanceClientError(
      'Bara attendance integration is not configured',
      'configuration',
      false,
    )
  }
  const localHttp =
    baseUrl.protocol === 'http:' &&
    (baseUrl.hostname === 'localhost' || baseUrl.hostname === '127.0.0.1')
  if (
    (baseUrl.protocol !== 'https:' && !localHttp) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.pathname !== '/' ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new BaraAttendanceClientError(
      'Bara attendance integration is not configured',
      'configuration',
      false,
    )
  }

  const installationRef = process.env.BARA_ATTENDANCE_INSTALLATION_REF?.trim() ?? ''
  const secret = process.env.BARA_ATTENDANCE_INTEGRATION_SECRET ?? ''
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(installationRef) || secret.length < 32) {
    throw new BaraAttendanceClientError(
      'Bara attendance integration is not configured',
      'configuration',
      false,
    )
  }
  return { baseUrl: baseUrl.origin, installationRef, secret }
}

export function getBaraAttendanceIntegrationState(): 'disabled' | 'not_configured' | 'ready' {
  if (process.env.PIKA_BARA_ATTENDANCE_ENABLED !== 'true') return 'disabled'
  try {
    configuration()
    return 'ready'
  } catch (error) {
    if (error instanceof BaraAttendanceClientError && error.code === 'configuration') {
      return 'not_configured'
    }
    throw error
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSuccess(value: unknown): BaraRosterSnapshotResult | null {
  if (!isPlainObject(value)) return null
  const expectedKeys = [
    'ok',
    'outcome',
    'roster_ref',
    'revision',
    'created_count',
    'updated_count',
    'deactivated_count',
  ]
  if (
    Object.keys(value).some((key) => !expectedKeys.includes(key)) ||
    expectedKeys.some((key) => !(key in value)) ||
    value.ok !== true ||
    (value.outcome !== 'applied' && value.outcome !== 'duplicate') ||
    typeof value.roster_ref !== 'string' ||
    !Number.isInteger(value.revision) ||
    !Number.isInteger(value.created_count) ||
    !Number.isInteger(value.updated_count) ||
    !Number.isInteger(value.deactivated_count)
  ) {
    return null
  }
  return {
    outcome: value.outcome,
    rosterRef: value.roster_ref,
    revision: value.revision as number,
    createdCount: value.created_count as number,
    updatedCount: value.updated_count as number,
    deactivatedCount: value.deactivated_count as number,
  }
}

function parseScheduleSuccess(value: unknown): BaraScheduleSnapshotResult | null {
  if (!isPlainObject(value)) return null
  const expectedKeys = [
    'ok',
    'outcome',
    'roster_ref',
    'revision',
    'scheduled_count',
    'updated_count',
    'cancelled_count',
    'preserved_count',
  ]
  if (
    Object.keys(value).some((key) => !expectedKeys.includes(key)) ||
    expectedKeys.some((key) => !(key in value)) ||
    value.ok !== true ||
    (value.outcome !== 'applied' && value.outcome !== 'duplicate') ||
    typeof value.roster_ref !== 'string' ||
    !Number.isInteger(value.revision) ||
    !Number.isInteger(value.scheduled_count) ||
    !Number.isInteger(value.updated_count) ||
    !Number.isInteger(value.cancelled_count) ||
    !Number.isInteger(value.preserved_count)
  ) {
    return null
  }
  return {
    outcome: value.outcome,
    rosterRef: value.roster_ref,
    revision: value.revision as number,
    scheduledCount: value.scheduled_count as number,
    updatedCount: value.updated_count as number,
    cancelledCount: value.cancelled_count as number,
    preservedCount: value.preserved_count as number,
  }
}

function parseSessionCommandSuccess(value: unknown): BaraSessionCommandResult | null {
  if (!isPlainObject(value)) return null
  const expectedKeys = ['ok', 'outcome', 'occurrence_ref', 'status', 'session_revision']
  if (
    Object.keys(value).some((key) => !expectedKeys.includes(key)) ||
    expectedKeys.some((key) => !(key in value)) ||
    value.ok !== true ||
    (value.outcome !== 'applied' && value.outcome !== 'duplicate' && value.outcome !== 'unchanged') ||
    typeof value.occurrence_ref !== 'string' ||
    (value.status !== 'open' && value.status !== 'closed') ||
    !Number.isInteger(value.session_revision)
  ) {
    return null
  }
  return {
    outcome: value.outcome,
    occurrenceRef: value.occurrence_ref,
    status: value.status,
    sessionRevision: value.session_revision as number,
  }
}

function parseAttendanceMarksSuccess(value: unknown): BaraAttendanceMarksResult | null {
  if (!isPlainObject(value)) return null
  const expectedKeys = [
    'ok',
    'outcome',
    'occurrence_ref',
    'session_revision',
    'applied_count',
    'unchanged_count',
  ]
  if (
    Object.keys(value).some((key) => !expectedKeys.includes(key)) ||
    expectedKeys.some((key) => !(key in value)) ||
    value.ok !== true ||
    (value.outcome !== 'applied' && value.outcome !== 'duplicate') ||
    typeof value.occurrence_ref !== 'string' ||
    !Number.isInteger(value.session_revision) ||
    !Number.isInteger(value.applied_count) ||
    !Number.isInteger(value.unchanged_count)
  ) {
    return null
  }
  return {
    outcome: value.outcome,
    occurrenceRef: value.occurrence_ref,
    sessionRevision: value.session_revision as number,
    appliedCount: value.applied_count as number,
    unchangedCount: value.unchanged_count as number,
  }
}

function parseCheckInPresentationSuccess(value: unknown): BaraCheckInPresentationResult | null {
  if (!isPlainObject(value)) return null
  const expectedKeys = [
    'ok',
    'schema_version',
    'occurrence_ref',
    'session_revision',
    'check_in_path',
    'valid_until',
  ]
  if (
    Object.keys(value).some((key) => !expectedKeys.includes(key)) ||
    expectedKeys.some((key) => !(key in value)) ||
    value.ok !== true ||
    value.schema_version !== 1 ||
    !isOpaqueRef(value.occurrence_ref) ||
    !Number.isInteger(value.session_revision) ||
    (value.session_revision as number) < 1 ||
    typeof value.check_in_path !== 'string' ||
    !/^\/check-in\/[A-Za-z0-9._~-]{20,128}$/.test(value.check_in_path) ||
    !isUtcInstant(value.valid_until)
  ) {
    return null
  }
  return {
    occurrenceRef: value.occurrence_ref,
    sessionRevision: value.session_revision as number,
    checkInPath: value.check_in_path,
    validUntil: value.valid_until,
  }
}

function parseStudentCheckInSuccess(value: unknown): BaraStudentCheckInResult | null {
  if (!isPlainObject(value)) return null
  const expectedKeys = [
    'ok',
    'schema_version',
    'outcome',
    'result_code',
    'occurrence_ref',
    'session_revision',
    'record',
  ]
  const resultCodes = new Set([
    'present_marked',
    'already_present',
    'already_late',
    'review_needed',
    'not_on_roster',
    'session_closed',
    'invalid_check_in_token',
    'not_authorized',
  ])
  if (
    Object.keys(value).some((key) => !expectedKeys.includes(key)) ||
    value.ok !== true ||
    value.schema_version !== 1 ||
    (value.outcome !== 'applied' && value.outcome !== 'duplicate' && value.outcome !== 'rejected') ||
    typeof value.result_code !== 'string' ||
    !resultCodes.has(value.result_code) ||
    !isOpaqueRef(value.occurrence_ref) ||
    !Number.isInteger(value.session_revision) ||
    (value.session_revision as number) < 1
  ) {
    return null
  }

  let record: BaraStudentCheckInResult['record']
  if (value.record !== undefined) {
    if (!isPlainObject(value.record)) return null
    const recordValue = value.record
    const recordKeys = ['participant_ref', 'record_revision', 'status', 'modified_at']
    if (
      Object.keys(recordValue).some((key) => !recordKeys.includes(key)) ||
      recordKeys.some((key) => !(key in recordValue)) ||
      !isOpaqueRef(recordValue.participant_ref) ||
      !Number.isInteger(recordValue.record_revision) ||
      (recordValue.record_revision as number) < 1 ||
      (recordValue.status !== 'unmarked' &&
        recordValue.status !== 'present' &&
        recordValue.status !== 'late' &&
        recordValue.status !== 'absent') ||
      !isUtcInstant(recordValue.modified_at)
    ) {
      return null
    }
    record = {
      participantRef: recordValue.participant_ref,
      recordRevision: recordValue.record_revision as number,
      status: recordValue.status,
      modifiedAt: recordValue.modified_at,
    }
  }

  return {
    outcome: value.outcome,
    resultCode: value.result_code as BaraStudentCheckInResult['resultCode'],
    occurrenceRef: value.occurrence_ref,
    sessionRevision: value.session_revision as number,
    ...(record ? { record } : {}),
  }
}

function isOpaqueRef(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._~-]{1,128}$/.test(value)
}

function isUtcInstant(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

function parseSessionSnapshot(value: unknown): V1SessionSnapshot | null {
  if (!isPlainObject(value)) return null
  const expectedKeys = [
    'ok',
    'schema_version',
    'occurrence_ref',
    'roster_ref',
    'session_revision',
    'status',
    'opens_at',
    'closes_at',
    'records',
  ]
  if (
    Object.keys(value).some((key) => !expectedKeys.includes(key)) ||
    expectedKeys.some((key) => !(key in value)) ||
    value.ok !== true ||
    value.schema_version !== 1 ||
    !isOpaqueRef(value.occurrence_ref) ||
    !isOpaqueRef(value.roster_ref) ||
    !Number.isInteger(value.session_revision) ||
    (value.session_revision as number) < 1 ||
    (value.status !== 'scheduled' &&
      value.status !== 'open' &&
      value.status !== 'closed' &&
      value.status !== 'cancelled') ||
    !isUtcInstant(value.opens_at) ||
    !isUtcInstant(value.closes_at) ||
    Date.parse(value.opens_at) >= Date.parse(value.closes_at) ||
    !Array.isArray(value.records) ||
    value.records.length > 1000
  ) {
    return null
  }

  const records: V1SessionSnapshot['records'] = []
  const participantRefs = new Set<string>()
  for (const record of value.records) {
    if (!isPlainObject(record)) return null
    const recordKeys = [
      'participant_ref',
      'record_revision',
      'status',
      'source',
      'actor_type',
      'modified_at',
    ]
    if (
      Object.keys(record).some((key) => !recordKeys.includes(key)) ||
      recordKeys.some((key) => !(key in record)) ||
      !isOpaqueRef(record.participant_ref) ||
      participantRefs.has(record.participant_ref) ||
      !Number.isInteger(record.record_revision) ||
      (record.record_revision as number) < 1 ||
      (record.status !== 'unmarked' &&
        record.status !== 'present' &&
        record.status !== 'late' &&
        record.status !== 'absent') ||
      (record.source !== 'student_qr' &&
        record.source !== 'staff_manual' &&
        record.source !== 'system_finalize') ||
      (record.actor_type !== 'student' &&
        record.actor_type !== 'staff' &&
        record.actor_type !== 'system') ||
      (record.source === 'student_qr' && record.actor_type !== 'student') ||
      (record.source === 'staff_manual' && record.actor_type !== 'staff') ||
      (record.source === 'system_finalize' && record.actor_type !== 'system') ||
      !isUtcInstant(record.modified_at)
    ) {
      return null
    }
    participantRefs.add(record.participant_ref)
    records.push(record as unknown as V1SessionSnapshot['records'][number])
  }

  return {
    schema_version: 1,
    occurrence_ref: value.occurrence_ref,
    roster_ref: value.roster_ref,
    session_revision: value.session_revision as number,
    status: value.status,
    opens_at: value.opens_at,
    closes_at: value.closes_at,
    records,
  }
}

async function responseJson(response: Response) {
  const text = await response.text()
  if (text.length > 20_000) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

async function signedRequest(
  config: ReturnType<typeof configuration>,
  method: 'GET' | 'PUT' | 'POST',
  path: string,
  body: string,
  options: ClientOptions,
) {
  const timestamp = String(Math.floor((options.now?.() ?? Date.now()) / 1000))
  const nonce = options.nonce?.() ?? `nonce_${crypto.randomUUID().replaceAll('-', '')}`
  const signature = await createV1RequestSignature({
    secret: config.secret,
    method,
    path,
    timestamp,
    nonce,
    body,
  })

  let response: Response
  try {
    response = await (options.fetcher ?? fetch)(`${config.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Attendance-Installation-Ref': config.installationRef,
        'X-Attendance-Timestamp': timestamp,
        'X-Attendance-Nonce': nonce,
        'X-Attendance-Signature': signature,
      },
      body: method === 'GET' ? undefined : body,
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new BaraAttendanceClientError(
      'Bara attendance could not be reached',
      'network_error',
      true,
    )
  }

  const parsed = await responseJson(response)
  if (!response.ok) {
    const remoteCode =
      isPlainObject(parsed) && typeof parsed.code === 'string' && /^[a-z_]{1,64}$/.test(parsed.code)
        ? parsed.code
        : isPlainObject(parsed) &&
            typeof parsed.error === 'string' &&
            /^[a-z_]{1,64}$/.test(parsed.error)
          ? parsed.error
          : 'remote_rejected'
    throw new BaraAttendanceClientError(
      'Bara rejected the attendance request',
      remoteCode,
      response.status === 408
        || response.status === 429
        || response.status >= 500
        || (response.status === 404 && remoteCode === 'not_found'),
      response.status,
    )
  }

  return { parsed, status: response.status }
}

export async function putBaraRosterSnapshot(
  payload: V1RosterSnapshot,
  options: ClientOptions = {},
): Promise<BaraRosterSnapshotResult> {
  const config = configuration()
  const validation = validateV1Message(payload)
  if (!validation.ok || validation.value.message_type !== 'roster.snapshot') {
    throw new BaraAttendanceClientError('Invalid Bara roster snapshot', 'invalid_payload', false)
  }
  if (validation.value.installation_ref !== config.installationRef) {
    throw new BaraAttendanceClientError('Invalid Bara roster snapshot', 'resource_mismatch', false)
  }

  const path = `/api/integrations/pika/v1/rosters/${validation.value.roster_ref}`
  const body = JSON.stringify(validation.value)
  const { parsed, status } = await signedRequest(config, 'PUT', path, body, options)

  const result = parseSuccess(parsed)
  if (!result || result.rosterRef !== validation.value.roster_ref || result.revision !== validation.value.revision) {
    throw new BaraAttendanceClientError(
      'Bara returned an invalid attendance response',
      'invalid_response',
      true,
      status,
    )
  }
  return result
}

export async function putBaraScheduleSnapshot(
  payload: V1ScheduleSnapshot,
  options: ClientOptions = {},
): Promise<BaraScheduleSnapshotResult> {
  const config = configuration()
  const validation = validateV1Message(payload)
  if (!validation.ok || validation.value.message_type !== 'schedule.snapshot') {
    throw new BaraAttendanceClientError('Invalid Bara schedule snapshot', 'invalid_payload', false)
  }
  if (validation.value.installation_ref !== config.installationRef) {
    throw new BaraAttendanceClientError('Invalid Bara schedule snapshot', 'resource_mismatch', false)
  }

  const path = `/api/integrations/pika/v1/schedules/${validation.value.roster_ref}`
  const body = JSON.stringify(validation.value)
  const { parsed, status } = await signedRequest(config, 'PUT', path, body, options)
  const result = parseScheduleSuccess(parsed)
  if (!result || result.rosterRef !== validation.value.roster_ref || result.revision !== validation.value.revision) {
    throw new BaraAttendanceClientError(
      'Bara returned an invalid attendance response',
      'invalid_response',
      true,
      status,
    )
  }
  return result
}

export async function postBaraSessionCommand(
  payload: V1SessionCommand,
  options: ClientOptions = {},
): Promise<BaraSessionCommandResult> {
  const config = configuration()
  const validation = validateV1Message(payload)
  if (!validation.ok || validation.value.message_type !== 'session.command') {
    throw new BaraAttendanceClientError('Invalid Bara session command', 'invalid_payload', false)
  }
  if (validation.value.installation_ref !== config.installationRef) {
    throw new BaraAttendanceClientError('Invalid Bara session command', 'resource_mismatch', false)
  }

  const path = `/api/integrations/pika/v1/sessions/${validation.value.occurrence_ref}/commands`
  const body = JSON.stringify(validation.value)
  const { parsed, status } = await signedRequest(config, 'POST', path, body, options)
  const result = parseSessionCommandSuccess(parsed)
  if (
    !result ||
    result.occurrenceRef !== validation.value.occurrence_ref
  ) {
    throw new BaraAttendanceClientError(
      'Bara returned an invalid attendance response',
      'invalid_response',
      true,
      status,
    )
  }
  return result
}

export async function postBaraAttendanceMarks(
  payload: V1AttendanceMarks,
  options: ClientOptions = {},
): Promise<BaraAttendanceMarksResult> {
  const config = configuration()
  const validation = validateV1Message(payload)
  if (!validation.ok || validation.value.message_type !== 'attendance.marks') {
    throw new BaraAttendanceClientError('Invalid Bara attendance marks', 'invalid_payload', false)
  }
  if (validation.value.installation_ref !== config.installationRef) {
    throw new BaraAttendanceClientError('Invalid Bara attendance marks', 'resource_mismatch', false)
  }

  const path = `/api/integrations/pika/v1/sessions/${validation.value.occurrence_ref}/marks`
  const body = JSON.stringify(validation.value)
  const { parsed, status } = await signedRequest(config, 'POST', path, body, options)
  const result = parseAttendanceMarksSuccess(parsed)
  if (!result || result.occurrenceRef !== validation.value.occurrence_ref) {
    throw new BaraAttendanceClientError(
      'Bara returned an invalid attendance response',
      'invalid_response',
      true,
      status,
    )
  }
  return result
}

export async function postBaraCheckInPresentation(
  payload: V1CheckInPresentationRequest,
  options: ClientOptions = {},
): Promise<BaraCheckInPresentationResult> {
  const config = configuration()
  const validation = validateV1Message(payload)
  if (!validation.ok || validation.value.message_type !== 'check_in.presentation') {
    throw new BaraAttendanceClientError(
      'Invalid Bara check-in presentation request',
      'invalid_payload',
      false,
    )
  }
  if (validation.value.installation_ref !== config.installationRef) {
    throw new BaraAttendanceClientError(
      'Invalid Bara check-in presentation request',
      'resource_mismatch',
      false,
    )
  }

  const path = `/api/integrations/pika/v1/sessions/${validation.value.occurrence_ref}/check-in`
  const body = JSON.stringify(validation.value)
  const { parsed, status } = await signedRequest(config, 'POST', path, body, options)
  const result = parseCheckInPresentationSuccess(parsed)
  if (!result || result.occurrenceRef !== validation.value.occurrence_ref) {
    throw new BaraAttendanceClientError(
      'Bara returned an invalid attendance response',
      'invalid_response',
      true,
      status,
    )
  }
  return result
}

export async function postBaraStudentCheckIn(
  payload: V1StudentCheckIn,
  options: ClientOptions = {},
): Promise<BaraStudentCheckInResult> {
  const config = configuration()
  const validation = validateV1Message(payload)
  if (!validation.ok || validation.value.message_type !== 'student_check_in') {
    throw new BaraAttendanceClientError('Invalid Bara student check-in', 'invalid_payload', false)
  }
  if (validation.value.installation_ref !== config.installationRef) {
    throw new BaraAttendanceClientError('Invalid Bara student check-in', 'resource_mismatch', false)
  }

  const path = `/api/integrations/pika/v1/sessions/${validation.value.occurrence_ref}/student-check-ins`
  const body = JSON.stringify(validation.value)
  const { parsed, status } = await signedRequest(config, 'POST', path, body, options)
  const result = parseStudentCheckInSuccess(parsed)
  if (!result || result.occurrenceRef !== validation.value.occurrence_ref) {
    throw new BaraAttendanceClientError(
      'Bara returned an invalid attendance response',
      'invalid_response',
      true,
      status,
    )
  }
  return result
}

export async function getBaraSessionSnapshot(
  occurrenceRef: string,
  options: ClientOptions = {},
): Promise<V1SessionSnapshot> {
  const config = configuration()
  if (!isOpaqueRef(occurrenceRef)) {
    throw new BaraAttendanceClientError('Invalid Bara occurrence reference', 'invalid_payload', false)
  }

  const path = `/api/integrations/pika/v1/sessions/${occurrenceRef}`
  const { parsed, status } = await signedRequest(config, 'GET', path, '', options)
  const result = parseSessionSnapshot(parsed)
  if (!result || result.occurrence_ref !== occurrenceRef) {
    throw new BaraAttendanceClientError(
      'Bara returned an invalid attendance response',
      'invalid_response',
      true,
      status,
    )
  }
  return result
}
