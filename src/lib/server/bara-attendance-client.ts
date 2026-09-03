import { createV1RequestSignature } from '@/vendor/attendance-contract/v1/signing'
import {
  DECOMMISSION_PATH, parseDecommissionRequest, parseDecommissionReceipt,
  type DecommissionRequest, type DecommissionReceipt,
} from '@/vendor/attendance-contract/decommission'
import type {
  V1CheckInInvalidate,
  V1CheckInPresentationRequest,
  V1RosterSnapshot,
  V1ScheduleSnapshot,
  V1SessionCommand,
  V1SessionSnapshot,
  V1StudentCheckIn,
} from '@/vendor/attendance-contract/v1/types'
import { validateV1Message } from '@/vendor/attendance-contract/v1/validate'

type Fetcher = typeof fetch

export type BaraAttendanceIntegrationState = 'disabled' | 'not_configured' | 'ready'

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

export interface BaraCheckInInvalidationResult {
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
    | 'check_in_accepted'
    | 'already_checked_in'
    | 'not_on_roster'
    | 'session_not_accepting'
    | 'invalid_check_in_token'
    | 'not_authorized'
  occurrenceRef: string
  sessionRevision: number
  checkIn?: {
    checkInRef: string
    participantRef: string
    checkInRevision: number
    acceptedAt: string
    invalidatedAt?: string
    reasonCode?: string
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

function configuration(allowDisabled = false) {
  if (!allowDisabled && process.env.PIKA_BARA_ATTENDANCE_ENABLED !== 'true') {
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

export function getBaraAttendanceIntegrationState(): BaraAttendanceIntegrationState {
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

function parseCheckInInvalidationSuccess(value: unknown): BaraCheckInInvalidationResult | null {
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
    'check_in',
  ]
  const requiredKeys = expectedKeys.filter((key) => key !== 'check_in')
  const resultCodes = new Set([
    'check_in_accepted',
    'already_checked_in',
    'not_on_roster',
    'session_not_accepting',
    'invalid_check_in_token',
    'not_authorized',
  ])
  if (
    Object.keys(value).some((key) => !expectedKeys.includes(key)) ||
    requiredKeys.some((key) => !(key in value)) ||
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

  let checkIn: BaraStudentCheckInResult['checkIn']
  if (value.check_in !== undefined) {
    if (!isPlainObject(value.check_in)) return null
    const recordValue = value.check_in
    const recordKeys = [
      'check_in_ref', 'participant_ref', 'check_in_revision', 'accepted_at',
      'invalidated_at', 'reason_code',
    ]
    if (
      Object.keys(recordValue).some((key) => !recordKeys.includes(key)) ||
      ['check_in_ref', 'participant_ref', 'check_in_revision', 'accepted_at']
        .some((key) => !(key in recordValue)) ||
      !isOpaqueRef(recordValue.check_in_ref) ||
      !isOpaqueRef(recordValue.participant_ref) ||
      !Number.isInteger(recordValue.check_in_revision) ||
      (recordValue.check_in_revision as number) < 1 ||
      !isUtcInstant(recordValue.accepted_at) ||
      (recordValue.invalidated_at !== undefined && !isUtcInstant(recordValue.invalidated_at)) ||
      (recordValue.reason_code !== undefined && !isOpaqueRef(recordValue.reason_code))
    ) {
      return null
    }
    checkIn = {
      checkInRef: recordValue.check_in_ref,
      participantRef: recordValue.participant_ref,
      checkInRevision: recordValue.check_in_revision as number,
      acceptedAt: recordValue.accepted_at,
      ...(recordValue.invalidated_at ? { invalidatedAt: recordValue.invalidated_at } : {}),
      ...(recordValue.reason_code ? { reasonCode: recordValue.reason_code } : {}),
    }
  }

  return {
    outcome: value.outcome,
    resultCode: value.result_code as BaraStudentCheckInResult['resultCode'],
    occurrenceRef: value.occurrence_ref,
    sessionRevision: value.session_revision as number,
    ...(checkIn ? { checkIn } : {}),
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
    'accepts_at',
    'stops_accepting_at',
    'check_ins',
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
    !isUtcInstant(value.accepts_at) ||
    !isUtcInstant(value.stops_accepting_at) ||
    Date.parse(value.accepts_at) >= Date.parse(value.stops_accepting_at) ||
    !Array.isArray(value.check_ins) ||
    value.check_ins.length > 1000
  ) {
    return null
  }

  const checkIns: V1SessionSnapshot['check_ins'] = []
  const checkInRefs = new Set<string>()
  for (const record of value.check_ins) {
    if (!isPlainObject(record)) return null
    const recordKeys = [
      'check_in_ref', 'participant_ref', 'check_in_revision', 'accepted_at',
      'invalidated_at', 'reason_code',
    ]
    if (
      Object.keys(record).some((key) => !recordKeys.includes(key)) ||
      ['check_in_ref', 'participant_ref', 'check_in_revision', 'accepted_at']
        .some((key) => !(key in record)) ||
      !isOpaqueRef(record.check_in_ref) ||
      !isOpaqueRef(record.participant_ref) ||
      checkInRefs.has(record.check_in_ref) ||
      !Number.isInteger(record.check_in_revision) ||
      (record.check_in_revision as number) < 1 ||
      !isUtcInstant(record.accepted_at) ||
      (record.invalidated_at !== undefined && !isUtcInstant(record.invalidated_at)) ||
      (record.reason_code !== undefined && !isOpaqueRef(record.reason_code))
    ) {
      return null
    }
    checkInRefs.add(record.check_in_ref)
    checkIns.push(record as unknown as V1SessionSnapshot['check_ins'][number])
  }

  return {
    schema_version: 1,
    occurrence_ref: value.occurrence_ref,
    roster_ref: value.roster_ref,
    session_revision: value.session_revision as number,
    status: value.status,
    accepts_at: value.accepts_at,
    stops_accepting_at: value.stops_accepting_at,
    check_ins: checkIns,
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
      redirect: 'error',
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
        || response.status >= 500,
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

export async function postBaraCheckInInvalidations(
  payload: V1CheckInInvalidate,
  options: ClientOptions = {},
): Promise<BaraCheckInInvalidationResult> {
  const config = configuration()
  const validation = validateV1Message(payload)
  if (!validation.ok || validation.value.message_type !== 'check_in.invalidate') {
    throw new BaraAttendanceClientError('Invalid Bara check-in invalidation', 'invalid_payload', false)
  }
  if (validation.value.installation_ref !== config.installationRef) {
    throw new BaraAttendanceClientError('Invalid Bara check-in invalidation', 'resource_mismatch', false)
  }

  const path = `/api/integrations/pika/v1/sessions/${validation.value.occurrence_ref}/check-in-invalidations`
  const body = JSON.stringify(validation.value)
  const { parsed, status } = await signedRequest(config, 'POST', path, body, options)
  const result = parseCheckInInvalidationSuccess(parsed)
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

// Dormant transport only: the database coordinator must fence Pika first.
// Disabling ordinary attendance must not prevent an authorized deletion retry.
export async function postBaraDecommission(
  payload: DecommissionRequest,
  options: ClientOptions = {},
): Promise<DecommissionReceipt> {
  const validated = parseDecommissionRequest(payload)
  if (!validated) throw new BaraAttendanceClientError('Invalid deletion request', 'invalid_payload', false)
  const mode = process.env.PIKA_BARA_DECOMMISSION_MODE
  if (mode !== 'enabled' && !(mode === 'canary' &&
    process.env.PIKA_BARA_DECOMMISSION_CANARY_ROSTER_REF === validated.roster_ref)) {
    throw new BaraAttendanceClientError('Attendance deletion is disabled', 'disabled', false)
  }
  const config = configuration(true)
  if (validated.installation_ref !== config.installationRef) {
    throw new BaraAttendanceClientError('Invalid deletion scope', 'resource_mismatch', false)
  }
  const { parsed, status } = await signedRequest(config, 'POST', DECOMMISSION_PATH, JSON.stringify(validated), options)
  const receipt = parseDecommissionReceipt(parsed, validated)
  if (!receipt) throw new BaraAttendanceClientError('Unverified deletion response', 'invalid_response', true, status)
  return receipt
}
