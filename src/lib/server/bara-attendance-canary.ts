import { z } from 'zod'

import {
  getBaraAttendanceIntegrationState,
  type BaraAttendanceIntegrationState,
} from '@/lib/server/bara-attendance-client'

const uuidSchema = z.string().uuid()
const classroomOwnerSchema = z.object({
  teacher_id: z.string().uuid(),
  archived_at: z.string().nullable(),
}).strict()

export interface BaraAttendanceCanaryScope {
  state: BaraAttendanceIntegrationState
  teacherId: string | null
  classroomId: string | null
}

export interface BaraAttendanceCanaryDatabaseAudit {
  ready: boolean
  failedChecks: string[]
}

export class BaraAttendanceCanaryError extends Error {
  constructor(readonly code: 'disabled' | 'not_configured') {
    super(code)
    this.name = 'BaraAttendanceCanaryError'
  }
}

export function getBaraAttendanceCanaryScope(): BaraAttendanceCanaryScope {
  const state = getBaraAttendanceIntegrationState()
  if (state !== 'ready') return { state, teacherId: null, classroomId: null }

  return getConfiguredBaraAttendanceCanaryScope()
}

export function getConfiguredBaraAttendanceCanaryScope(): BaraAttendanceCanaryScope {

  const teacher = uuidSchema.safeParse(
    process.env.PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID?.trim(),
  )
  const classroom = uuidSchema.safeParse(
    process.env.PIKA_BARA_ATTENDANCE_CANARY_CLASSROOM_ID?.trim(),
  )
  if (!teacher.success || !classroom.success) {
    return { state: 'not_configured', teacherId: null, classroomId: null }
  }
  return {
    state: 'ready',
    teacherId: teacher.data,
    classroomId: classroom.data,
  }
}

export function getBaraAttendanceClassroomIntegrationState(input: {
  teacherId: string
  classroomId: string
}): BaraAttendanceIntegrationState {
  const scope = getBaraAttendanceCanaryScope()
  if (scope.state !== 'ready') return scope.state
  return scope.teacherId === input.teacherId && scope.classroomId === input.classroomId
    ? 'ready'
    : 'disabled'
}

export function getBaraAttendanceClassroomIdIntegrationState(
  classroomId: string,
): BaraAttendanceIntegrationState {
  const scope = getBaraAttendanceCanaryScope()
  if (scope.state !== 'ready') return scope.state
  return scope.classroomId === classroomId ? 'ready' : 'disabled'
}

export function assertBaraAttendanceCanaryClassroom(input: {
  teacherId: string
  classroomId: string
}): void {
  const state = getBaraAttendanceClassroomIntegrationState(input)
  if (state !== 'ready') throw new BaraAttendanceCanaryError(state)
}

export async function auditBaraAttendanceCanaryDatabaseScope(input: {
  supabase: any
  teacherId: string
  classroomId: string
}): Promise<BaraAttendanceCanaryDatabaseAudit> {
  const teacher = uuidSchema.safeParse(input.teacherId)
  const classroom = uuidSchema.safeParse(input.classroomId)
  if (!teacher.success || !classroom.success) {
    return { ready: false, failedChecks: ['attendance_canary_database_scope'] }
  }

  const { data, error } = await input.supabase
    .from('classrooms')
    .select('teacher_id,archived_at')
    .eq('id', classroom.data)
    .maybeSingle()
  const owner = classroomOwnerSchema.safeParse(data)
  const ready = !error
    && owner.success
    && owner.data.teacher_id === teacher.data
    && owner.data.archived_at === null
  return {
    ready,
    failedChecks: ready ? [] : ['attendance_canary_database_scope'],
  }
}

export async function assertBaraAttendanceCanaryClassroomOwner(input: {
  supabase: any
  classroomId: string
}): Promise<void> {
  const scope = getBaraAttendanceCanaryScope()
  if (scope.state !== 'ready' || !scope.teacherId || !scope.classroomId) {
    throw new BaraAttendanceCanaryError(
      scope.state === 'ready' ? 'not_configured' : scope.state,
    )
  }
  if (scope.classroomId !== input.classroomId) {
    throw new BaraAttendanceCanaryError('disabled')
  }

  const audit = await auditBaraAttendanceCanaryDatabaseScope({
    supabase: input.supabase,
    teacherId: scope.teacherId,
    classroomId: input.classroomId,
  })
  if (!audit.ready) throw new BaraAttendanceCanaryError('not_configured')
}

export async function assertConfiguredBaraAttendanceCanaryClassroomOwner(input: {
  supabase: any
  classroomId: string
}): Promise<void> {
  const scope = getConfiguredBaraAttendanceCanaryScope()
  if (scope.state !== 'ready' || !scope.teacherId || scope.classroomId !== input.classroomId) {
    throw new BaraAttendanceCanaryError('not_configured')
  }
  const audit = await auditBaraAttendanceCanaryDatabaseScope({
    supabase: input.supabase,
    teacherId: scope.teacherId,
    classroomId: input.classroomId,
  })
  if (!audit.ready) throw new BaraAttendanceCanaryError('not_configured')
}
