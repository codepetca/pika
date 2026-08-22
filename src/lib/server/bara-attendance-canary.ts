import { z } from 'zod'

import {
  getBaraAttendanceIntegrationState,
  type BaraAttendanceIntegrationState,
} from '@/lib/server/bara-attendance-client'

const uuidSchema = z.string().uuid()
const classroomOwnerSchema = z.object({ teacher_id: z.string().uuid() }).strict()

export interface BaraAttendanceCanaryScope {
  state: BaraAttendanceIntegrationState
  teacherId: string | null
  classroomId: string | null
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

  const { data, error } = await input.supabase
    .from('classrooms')
    .select('teacher_id')
    .eq('id', input.classroomId)
    .maybeSingle()
  if (error) throw new BaraAttendanceCanaryError('not_configured')
  const owner = classroomOwnerSchema.safeParse(data)
  if (!owner.success || owner.data.teacher_id !== scope.teacherId) {
    throw new BaraAttendanceCanaryError('disabled')
  }
}
