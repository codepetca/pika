import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  BaraAttendanceClientError,
  getBaraAttendanceIntegrationState,
  postBaraStudentCheckIn,
  type BaraStudentCheckInResult,
} from '@/lib/server/bara-attendance-client'
import {
  AttendanceEntryTokenError,
  openAttendanceEntryToken,
} from '@/lib/server/bara-attendance-entry-token'
import type { V1StudentCheckIn } from '@/vendor/attendance-contract/v1/types'

const actorUserSchema = z.object({
  email: z.string().email(),
  role: z.literal('student'),
  workos_user_id: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/),
}).strict()
const actorProfileSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
}).strict()

export interface VerifiedPikaAttendanceStudent {
  workosSubject: string
  displayName: string
}

export interface StudentAttendanceCheckInView {
  state: 'checked_in' | 'already_checked_in' | 'needs_staff' | 'closed' | 'invalid'
  title: string
  description: string
  attendanceStatus?: 'present' | 'late'
  recordedAt?: string
}

export class StudentAttendanceCheckInError extends Error {
  constructor(readonly code:
    | 'disabled'
    | 'not_configured'
    | 'invalid_entry'
    | 'expired_entry'
    | 'identity_not_linked'
    | 'upstream_unavailable',
  ) {
    super(code)
    this.name = 'StudentAttendanceCheckInError'
  }
}

export async function resolveVerifiedPikaAttendanceStudent(input: {
  supabase: any
  pikaUser: { id: string; email: string; role: string }
}): Promise<VerifiedPikaAttendanceStudent> {
  const { withAuth } = await import('@workos-inc/authkit-nextjs')
  const { user: workOSUser } = await withAuth()
  if (!workOSUser || !workOSUser.emailVerified || input.pikaUser.role !== 'student') {
    throw new StudentAttendanceCheckInError('identity_not_linked')
  }

  const [userResult, profileResult] = await Promise.all([
    input.supabase
      .from('users')
      .select('email, role, workos_user_id')
      .eq('id', input.pikaUser.id)
      .maybeSingle(),
    input.supabase
      .from('student_profiles')
      .select('first_name, last_name')
      .eq('user_id', input.pikaUser.id)
      .maybeSingle(),
  ])
  if (userResult.error || profileResult.error) {
    throw new StudentAttendanceCheckInError('upstream_unavailable')
  }
  const user = actorUserSchema.safeParse(userResult.data)
  const profile = actorProfileSchema.safeParse(profileResult.data)
  if (!user.success || !profile.success) {
    throw new StudentAttendanceCheckInError('identity_not_linked')
  }
  if (
    user.data.workos_user_id !== workOSUser.id ||
    user.data.email.trim().toLowerCase() !== workOSUser.email.trim().toLowerCase() ||
    user.data.email.trim().toLowerCase() !== input.pikaUser.email.trim().toLowerCase()
  ) {
    throw new StudentAttendanceCheckInError('identity_not_linked')
  }
  return {
    workosSubject: workOSUser.id,
    displayName: `${profile.data.first_name.trim()} ${profile.data.last_name.trim()}`,
  }
}

function mapResult(result: BaraStudentCheckInResult): StudentAttendanceCheckInView {
  switch (result.resultCode) {
    case 'present_marked':
      return {
        state: 'checked_in',
        title: 'You are checked in',
        description: 'Your attendance was recorded.',
        attendanceStatus: 'present',
        ...(result.record ? { recordedAt: result.record.modifiedAt } : {}),
      }
    case 'already_present':
    case 'already_late':
      return {
        state: 'already_checked_in',
        title: 'You are already checked in',
        description: 'No additional attendance record was created.',
        attendanceStatus: result.resultCode === 'already_late' ? 'late' : 'present',
        ...(result.record ? { recordedAt: result.record.modifiedAt } : {}),
      }
    case 'session_closed':
      return {
        state: 'closed',
        title: 'Check-in is closed',
        description: 'Ask your teacher if your attendance needs to be corrected.',
      }
    case 'invalid_check_in_token':
      return {
        state: 'invalid',
        title: 'This QR code is no longer valid',
        description: 'Ask your teacher to show the current attendance QR code.',
      }
    case 'review_needed':
    case 'not_on_roster':
    case 'not_authorized':
      return {
        state: 'needs_staff',
        title: 'Your teacher needs to help',
        description: 'Ask your teacher to check your roster and attendance.',
      }
  }
}

export async function executeStudentAttendanceCheckIn(input: {
  supabase: any
  pikaUser: { id: string; email: string; role: string }
  entryToken: string
  integrationState?: 'disabled' | 'not_configured' | 'ready'
  resolveActor?: typeof resolveVerifiedPikaAttendanceStudent
  send?: (payload: V1StudentCheckIn) => Promise<BaraStudentCheckInResult>
}) {
  const integrationState = input.integrationState ?? getBaraAttendanceIntegrationState()
  if (integrationState !== 'ready') {
    throw new StudentAttendanceCheckInError(integrationState)
  }

  let entry
  try {
    entry = openAttendanceEntryToken(input.entryToken)
  } catch (error) {
    if (error instanceof AttendanceEntryTokenError) {
      if (error.code === 'expired') throw new StudentAttendanceCheckInError('expired_entry')
      if (error.code === 'not_configured') throw new StudentAttendanceCheckInError('not_configured')
      throw new StudentAttendanceCheckInError('invalid_entry')
    }
    throw error
  }

  const actor = await (input.resolveActor ?? resolveVerifiedPikaAttendanceStudent)({
    supabase: input.supabase,
    pikaUser: input.pikaUser,
  })
  const installationRef = process.env.BARA_ATTENDANCE_INSTALLATION_REF?.trim() ?? ''
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(installationRef)) {
    throw new StudentAttendanceCheckInError('not_configured')
  }
  const digest = createHash('sha256')
    .update(`${entry.occurrenceRef}\0${entry.checkInToken}\0${actor.workosSubject}`)
    .digest('hex')
    .slice(0, 40)
  const payload: V1StudentCheckIn = {
    schema_version: 1,
    message_type: 'student_check_in',
    idempotency_key: `student-check-in:${entry.occurrenceRef}:${digest}`,
    correlation_ref: `student_check_in_${digest}`,
    installation_ref: installationRef,
    roster_ref: entry.rosterRef,
    occurrence_ref: entry.occurrenceRef,
    check_in_token: entry.checkInToken,
    actor_workos_subject: actor.workosSubject,
    actor_display_name: actor.displayName,
  }

  const send = input.send ?? postBaraStudentCheckIn
  let result: BaraStudentCheckInResult
  try {
    result = await send(payload)
  } catch (error) {
    if (!(error instanceof BaraAttendanceClientError)) throw error
    if (!error.retryable) {
      throw new StudentAttendanceCheckInError('upstream_unavailable')
    }
    try {
      // A timeout has an uncertain outcome. Retry once with the same command
      // body/idempotency key and a fresh transport nonce before telling the
      // student that the result is unavailable.
      result = await send(payload)
    } catch {
      throw new StudentAttendanceCheckInError('upstream_unavailable')
    }
  }
  return mapResult(result)
}
