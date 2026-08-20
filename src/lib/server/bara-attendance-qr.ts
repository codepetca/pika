import {
  BaraAttendanceClientError,
  getBaraAttendanceIntegrationState,
  postBaraCheckInPresentation,
  type BaraCheckInPresentationResult,
} from '@/lib/server/bara-attendance-client'
import {
  createSupabaseAttendanceCommandStore,
  TeacherAttendanceCommandError,
  type AttendanceCommandStore,
} from '@/lib/server/bara-attendance-commands'
import type { V1CheckInPresentationRequest } from '@/vendor/attendance-contract/v1/types'
import { sealAttendanceEntryToken } from '@/lib/server/bara-attendance-entry-token'
import type { VerifiedPikaAttendanceTeacher } from '@/lib/server/bara-attendance-teacher'

const CHECK_IN_PATH = /^\/check-in\/([A-Za-z0-9._~-]{20,128})$/

export class TeacherAttendanceQrError extends Error {
  constructor(readonly code:
    | 'disabled'
    | 'not_configured'
    | 'migration_required'
    | 'identity_not_linked'
    | 'mapping_missing'
    | 'session_not_open'
    | 'upstream_unavailable',
  ) {
    super(code)
    this.name = 'TeacherAttendanceQrError'
  }
}

function requestRefs(requestId: string) {
  const compact = requestId.replaceAll('-', '')
  return {
    compact,
    correlationRef: `correlation_${compact}`,
  }
}

function mapError(error: unknown): never {
  if (error instanceof TeacherAttendanceCommandError) {
    if (
      error.code === 'disabled' ||
      error.code === 'not_configured' ||
      error.code === 'migration_required' ||
      error.code === 'identity_not_linked' ||
      error.code === 'mapping_missing'
    ) {
      throw new TeacherAttendanceQrError(error.code)
    }
    throw new TeacherAttendanceQrError('upstream_unavailable')
  }
  if (error instanceof BaraAttendanceClientError) {
    if (error.code === 'disabled') throw new TeacherAttendanceQrError('disabled')
    if (error.code === 'configuration') throw new TeacherAttendanceQrError('not_configured')
    if (error.status === 409 || error.code === 'invalid_session_state') {
      throw new TeacherAttendanceQrError('session_not_open')
    }
    throw new TeacherAttendanceQrError('upstream_unavailable')
  }
  throw error
}

export async function loadTeacherAttendanceQrPresentation(input: {
  supabase: any
  teacherId: string
  classroomId: string
  classDate: string
  requestId: string
  actor: VerifiedPikaAttendanceTeacher
  integrationState?: 'disabled' | 'not_configured' | 'ready'
  store?: AttendanceCommandStore
  send?: (payload: V1CheckInPresentationRequest) => Promise<BaraCheckInPresentationResult>
  sealEntryToken?: typeof sealAttendanceEntryToken
}) {
  const integrationState = input.integrationState ?? getBaraAttendanceIntegrationState()
  if (integrationState !== 'ready') throw new TeacherAttendanceQrError(integrationState)

  const store = input.store ?? createSupabaseAttendanceCommandStore(input.supabase)
  try {
    const context = await store.loadContext(input)
    const refs = requestRefs(input.requestId)
    const payload: V1CheckInPresentationRequest = {
      schema_version: 1,
      message_type: 'check_in.presentation',
      idempotency_key: `check-in:${context.occurrenceRef}:${refs.compact}`,
      correlation_ref: refs.correlationRef,
      installation_ref: context.installationRef,
      roster_ref: context.rosterRef,
      occurrence_ref: context.occurrenceRef,
      actor_workos_subject: context.actorWorkosSubject,
      actor_display_name: context.actorDisplayName,
    }
    const result = await (input.send
      ? input.send(payload)
      : postBaraCheckInPresentation(payload))
    const pathMatch = CHECK_IN_PATH.exec(result.checkInPath)
    if (!pathMatch) throw new TeacherAttendanceQrError('upstream_unavailable')

    const entryToken = (input.sealEntryToken ?? sealAttendanceEntryToken)({
      rosterRef: context.rosterRef,
      occurrenceRef: result.occurrenceRef,
      checkInToken: pathMatch[1],
      expiresAt: result.validUntil,
    })
    return {
      entryPath: `/attendance/check-in/${entryToken}`,
      expiresAt: result.validUntil,
      revision: result.sessionRevision,
    }
  } catch (error) {
    if (error instanceof TeacherAttendanceQrError) throw error
    mapError(error)
  }
}
