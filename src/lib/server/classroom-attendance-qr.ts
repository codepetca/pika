import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { z } from 'zod'
import {
  loadTeacherAttendanceQrPresentation,
  TeacherAttendanceQrError,
} from '@/lib/server/bara-attendance-qr'
import {
  executeStudentAttendanceCheckIn,
  StudentAttendanceCheckInError,
  type StudentAttendanceCheckInView,
} from '@/lib/server/bara-attendance-student'
import { getBaraAttendanceClassroomIdAccess } from '@/lib/server/bara-attendance-scope'
import { isClassroomQrRolloutAllowed } from '@/lib/server/classroom-qr-rollout'

const CLASSROOM_QR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const ENTRY_PATH_PATTERN = /^\/attendance\/check-in\/([A-Za-z0-9_-]{80,768})$/
const QR_MAC_BYTES = 16
const qrHandleRowSchema = z.object({
  classroom_id: z.string().uuid(),
  handle_id: z.string().uuid(),
  generation: z.number().int().safe().positive(),
  rotated_at: z.string().datetime({ offset: true }),
}).strict()
const occurrenceRowSchema = z.object({
  occurrence_ref: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/),
  class_date: z.string().date(),
  opens_at: z.string().datetime({ offset: true }),
  closes_at: z.string().datetime({ offset: true }),
  desired_state: z.literal('scheduled'),
}).strict()
const classroomRowSchema = z.object({
  teacher_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  archived_at: z.string().datetime({ offset: true }).nullable(),
}).strict()
const teacherRowSchema = z.object({
  workos_user_id: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/),
}).strict()

export interface TeacherClassroomQrPresentation {
  entryPath: string
  generation: number
  rotatedAt: string
}

export class ClassroomAttendanceQrError extends Error {
  constructor(readonly code:
    | 'not_configured'
    | 'migration_required'
    | 'invalid_or_revoked'
    | 'not_open'
    | 'not_enrolled'
    | 'conflict'
    | 'unavailable',
  ) {
    super(code)
    this.name = 'ClassroomAttendanceQrError'
  }
}

function qrSecret(secret = process.env.BARA_ATTENDANCE_ENTRY_TOKEN_SECRET) {
  if (!secret || secret.length < 32) throw new ClassroomAttendanceQrError('not_configured')
  return secret
}

function uuidBytes(uuid: string) {
  const compact = uuid.replaceAll('-', '')
  if (!/^[a-f0-9]{32}$/i.test(compact)) throw new ClassroomAttendanceQrError('invalid_or_revoked')
  return Buffer.from(compact, 'hex')
}

function bytesUuid(bytes: Buffer) {
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function handleMac(handleBytes: Buffer, secret?: string) {
  return createHmac('sha256', qrSecret(secret))
    .update('pika-classroom-attendance-qr-v1\0', 'utf8')
    .update(handleBytes)
    .digest()
    .subarray(0, QR_MAC_BYTES)
}

export function createClassroomAttendanceQrToken(handleId: string, secret?: string) {
  const handle = uuidBytes(handleId)
  return Buffer.concat([handle, handleMac(handle, secret)]).toString('base64url')
}

export function openClassroomAttendanceQrToken(token: string, secret?: string) {
  if (!CLASSROOM_QR_TOKEN_PATTERN.test(token)) {
    throw new ClassroomAttendanceQrError('invalid_or_revoked')
  }
  const decoded = Buffer.from(token, 'base64url')
  if (decoded.length !== 32 || decoded.toString('base64url') !== token) {
    throw new ClassroomAttendanceQrError('invalid_or_revoked')
  }
  const handle = decoded.subarray(0, 16)
  const mac = decoded.subarray(16)
  if (!timingSafeEqual(mac, handleMac(handle, secret))) {
    throw new ClassroomAttendanceQrError('invalid_or_revoked')
  }
  return bytesUuid(handle)
}

function mapDatabaseError(error: { code?: string } | null): never {
  if (error?.code === '42P01' || error?.code === 'PGRST205') {
    throw new ClassroomAttendanceQrError('migration_required')
  }
  throw new ClassroomAttendanceQrError('unavailable')
}

async function loadQrRowByClassroom(supabase: any, classroomId: string) {
  const { data, error } = await supabase
    .from('attendance_classroom_qr_handles')
    .select('classroom_id, handle_id, generation, rotated_at')
    .eq('classroom_id', classroomId)
    .maybeSingle()
  if (error) mapDatabaseError(error)
  if (!data) return null
  const parsed = qrHandleRowSchema.safeParse(data)
  if (!parsed.success) throw new ClassroomAttendanceQrError('unavailable')
  return parsed.data
}

export async function loadTeacherClassroomQrPresentation(input: {
  supabase: any
  teacherId: string
  classroomId: string
  createHandleId?: () => string
}) : Promise<TeacherClassroomQrPresentation> {
  if (!isClassroomQrRolloutAllowed(input)) throw new ClassroomAttendanceQrError('not_open')
  qrSecret()
  let row = await loadQrRowByClassroom(input.supabase, input.classroomId)
  if (!row) {
    const handleId = (input.createHandleId ?? randomUUID)()
    const { data, error } = await input.supabase
      .from('attendance_classroom_qr_handles')
      .insert({ classroom_id: input.classroomId, handle_id: handleId })
      .select('classroom_id, handle_id, generation, rotated_at')
      .single()
    if (error) {
      if (error.code === '23505') row = await loadQrRowByClassroom(input.supabase, input.classroomId)
      else mapDatabaseError(error)
    } else {
      const parsed = qrHandleRowSchema.safeParse(data)
      if (!parsed.success) throw new ClassroomAttendanceQrError('unavailable')
      row = parsed.data
    }
  }
  if (!row) throw new ClassroomAttendanceQrError('unavailable')
  return {
    entryPath: `/attendance/classroom/${createClassroomAttendanceQrToken(row.handle_id)}`,
    generation: row.generation,
    rotatedAt: row.rotated_at,
  }
}

export async function rotateTeacherClassroomQrPresentation(input: {
  supabase: any
  teacherId: string
  classroomId: string
  expectedGeneration: number
  createHandleId?: () => string
  now?: () => string
}) : Promise<TeacherClassroomQrPresentation> {
  if (!isClassroomQrRolloutAllowed(input)) throw new ClassroomAttendanceQrError('not_open')
  qrSecret()
  const nextHandleId = (input.createHandleId ?? randomUUID)()
  const rotatedAt = (input.now ?? (() => new Date().toISOString()))()
  const { data, error } = await input.supabase
    .from('attendance_classroom_qr_handles')
    .update({
      handle_id: nextHandleId,
      generation: input.expectedGeneration + 1,
      rotated_at: rotatedAt,
      updated_at: rotatedAt,
    })
    .eq('classroom_id', input.classroomId)
    .eq('generation', input.expectedGeneration)
    .select('classroom_id, handle_id, generation, rotated_at')
    .maybeSingle()
  if (error) mapDatabaseError(error)
  if (!data) throw new ClassroomAttendanceQrError('conflict')
  const parsed = qrHandleRowSchema.safeParse(data)
  if (!parsed.success) throw new ClassroomAttendanceQrError('unavailable')
  return {
    entryPath: `/attendance/classroom/${createClassroomAttendanceQrToken(parsed.data.handle_id)}`,
    generation: parsed.data.generation,
    rotatedAt: parsed.data.rotated_at,
  }
}

async function resolveClassroomId(supabase: any, token: string) {
  const handleId = openClassroomAttendanceQrToken(token)
  const { data, error } = await supabase
    .from('attendance_classroom_qr_handles')
    .select('classroom_id, handle_id, generation, rotated_at')
    .eq('handle_id', handleId)
    .maybeSingle()
  if (error) mapDatabaseError(error)
  const parsed = qrHandleRowSchema.safeParse(data)
  if (!parsed.success || parsed.data.handle_id !== handleId) {
    throw new ClassroomAttendanceQrError('invalid_or_revoked')
  }
  return parsed.data.classroom_id
}

async function loadCurrentOpenOccurrence(input: {
  supabase: any
  classroomId: string
  now: Date
}) {
  const installationRef = process.env.BARA_ATTENDANCE_INSTALLATION_REF?.trim() ?? ''
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(installationRef)) {
    throw new ClassroomAttendanceQrError('not_configured')
  }
  // Select eligible windows first so a delayed historical close event cannot
  // hide today's open attendance. Ambiguous overlapping windows fail closed.
  const { data, error } = await input.supabase
    .from('attendance_occurrence_mappings')
    .select('occurrence_ref, class_date, opens_at, closes_at, desired_state')
    .eq('classroom_id', input.classroomId)
    .eq('desired_state', 'scheduled')
    .lte('opens_at', input.now.toISOString())
    .gt('closes_at', input.now.toISOString())
    .limit(2)
  if (error) mapDatabaseError(error)
  const occurrences = z.array(occurrenceRowSchema).safeParse(data)
  if (!occurrences.success || occurrences.data.length !== 1) {
    throw new ClassroomAttendanceQrError('not_open')
  }
  const occurrence = occurrences.data[0]
  // Local teacher changes are authoritative immediately; provider cancellation
  // and the corresponding projection update are asynchronous.
  const [policy, classDay] = await Promise.all([
    input.supabase.from('attendance_window_policies').select('enabled')
      .eq('classroom_id', input.classroomId).maybeSingle(),
    input.supabase.from('class_days').select('is_class_day')
      .eq('classroom_id', input.classroomId).eq('date', occurrence.class_date).maybeSingle(),
  ])
  if (policy.error || classDay.error) throw new ClassroomAttendanceQrError('unavailable')
  if (policy.data?.enabled !== true || classDay.data?.is_class_day !== true) {
    throw new ClassroomAttendanceQrError('not_open')
  }
  const { data: session, error: sessionError } = await input.supabase
    .from('attendance_session_projection')
    .select('occurrence_ref')
    .eq('classroom_id', input.classroomId)
    .eq('installation_ref', installationRef)
    .eq('occurrence_ref', occurrence.occurrence_ref)
    .eq('status', 'open')
    .maybeSingle()
  if (sessionError) mapDatabaseError(sessionError)
  if (!session || session.occurrence_ref !== occurrence.occurrence_ref) {
    throw new ClassroomAttendanceQrError('not_open')
  }
  return occurrence
}

async function assertStudentRosterBoundary(input: {
  supabase: any
  classroomId: string
  studentId: string
}) {
  const [enrollment, participant] = await Promise.all([
    input.supabase.from('classroom_enrollments').select('id')
      .eq('classroom_id', input.classroomId).eq('student_id', input.studentId).maybeSingle(),
    input.supabase.from('attendance_participant_mappings').select('student_id, active')
      .eq('classroom_id', input.classroomId).eq('student_id', input.studentId).eq('active', true).maybeSingle(),
  ])
  if (enrollment.error || participant.error) throw new ClassroomAttendanceQrError('unavailable')
  if (!enrollment.data || !participant.data) throw new ClassroomAttendanceQrError('not_enrolled')
}

async function loadClassroomActor(input: { supabase: any; classroomId: string }) {
  const { data, error } = await input.supabase.from('classrooms')
    .select('teacher_id, title, archived_at').eq('id', input.classroomId).maybeSingle()
  if (error) throw new ClassroomAttendanceQrError('unavailable')
  const classroom = classroomRowSchema.safeParse(data)
  if (!classroom.success || classroom.data.archived_at) {
    throw new ClassroomAttendanceQrError('not_open')
  }
  const teacherResult = await input.supabase.from('users').select('workos_user_id')
    .eq('id', classroom.data.teacher_id).maybeSingle()
  if (teacherResult.error) throw new ClassroomAttendanceQrError('unavailable')
  const teacher = teacherRowSchema.safeParse(teacherResult.data)
  if (!teacher.success) throw new ClassroomAttendanceQrError('unavailable')
  return {
    teacherId: classroom.data.teacher_id,
    actor: {
      workosSubject: teacher.data.workos_user_id,
      displayName: `${classroom.data.title} attendance`.slice(0, 200),
    },
  }
}

export async function executeClassroomQrStudentCheckIn(input: {
  supabase: any
  pikaUser: { id: string; email: string; role: string }
  classroomQrToken: string
  attemptId: string
  now?: Date
  loadPresentation?: typeof loadTeacherAttendanceQrPresentation
  executeCheckIn?: typeof executeStudentAttendanceCheckIn
}): Promise<StudentAttendanceCheckInView & {
  classroomId?: string
  studentId?: string
  occurrenceBinding?: string
}> {
  const classroomId = await resolveClassroomId(input.supabase, input.classroomQrToken)
  const access = await getBaraAttendanceClassroomIdAccess({
    supabase: input.supabase,
    classroomId,
    now: input.now,
  })
  if (access.state !== 'ready') throw new ClassroomAttendanceQrError('not_open')
  const { teacherId, actor } = await loadClassroomActor({ supabase: input.supabase, classroomId })
  if (!isClassroomQrRolloutAllowed({ teacherId, classroomId })) {
    throw new ClassroomAttendanceQrError('not_open')
  }
  await assertStudentRosterBoundary({
    supabase: input.supabase,
    classroomId,
    studentId: input.pikaUser.id,
  })
  const occurrence = await loadCurrentOpenOccurrence({
    supabase: input.supabase,
    classroomId,
    now: input.now ?? new Date(),
  })
  let presentation
  try {
    presentation = await (input.loadPresentation ?? loadTeacherAttendanceQrPresentation)({
      supabase: input.supabase,
      teacherId,
      classroomId,
      classDate: occurrence.class_date,
      requestId: randomUUID(),
      actor,
      integrationState: 'ready',
    })
  } catch (error) {
    if (error instanceof TeacherAttendanceQrError && error.code === 'session_not_open') {
      throw new ClassroomAttendanceQrError('not_open')
    }
    if (error instanceof TeacherAttendanceQrError) throw new ClassroomAttendanceQrError('unavailable')
    throw error
  }
  const match = ENTRY_PATH_PATTERN.exec(presentation.entryPath)
  if (!match) throw new ClassroomAttendanceQrError('unavailable')
  try {
    return await (input.executeCheckIn ?? executeStudentAttendanceCheckIn)({
      supabase: input.supabase,
      pikaUser: input.pikaUser,
      entryToken: match[1],
      attemptId: input.attemptId,
      integrationState: 'ready',
    })
  } catch (error) {
    if (error instanceof StudentAttendanceCheckInError && error.code === 'expired_entry') {
      throw new ClassroomAttendanceQrError('not_open')
    }
    throw error
  }
}
