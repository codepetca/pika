import { z } from 'zod'

import { getBaraAttendanceIntegrationState } from '@/lib/server/bara-attendance-client'
import {
  assertBaraAttendanceCanaryClassroom,
  assertBaraAttendanceCanaryClassroomOwner,
  BaraAttendanceCanaryError,
  getBaraAttendanceClassroomIntegrationState,
  getBaraAttendanceCanaryScope,
} from '@/lib/server/bara-attendance-canary'

export type BaraAttendanceScopeMode = 'exact_canary' | 'teacher_entitlements'

const accessSchema = z.object({
  state: z.enum(['disabled', 'ready']),
  schedule_through: z.string().date().nullable(),
}).strict()

export interface BaraAttendanceClassroomAccess {
  state: 'disabled' | 'not_configured' | 'ready'
  scheduleThrough: string | null
}

export function getBaraAttendanceScopeMode(): BaraAttendanceScopeMode {
  return process.env.PIKA_BARA_ATTENDANCE_SCOPE_MODE?.trim() === 'teacher_entitlements'
    ? 'teacher_entitlements'
    : 'exact_canary'
}

export function getBaraAttendanceWorkerScope() {
  const mode = getBaraAttendanceScopeMode()
  if (mode === 'exact_canary') {
    const canary = getBaraAttendanceCanaryScope()
    return { mode, ...canary }
  }
  return {
    mode,
    state: getBaraAttendanceIntegrationState(),
    teacherId: null,
    classroomId: null,
  }
}

async function loadEntitledAccess(input: {
  supabase: any
  teacherId?: string
  classroomId: string
  now?: Date
}): Promise<BaraAttendanceClassroomAccess> {
  const rpcName = input.teacherId
    ? 'get_attendance_classroom_access_v1'
    : 'get_attendance_classroom_id_access_v1'
  const args = input.teacherId
    ? {
        p_teacher_id: input.teacherId,
        p_classroom_id: input.classroomId,
        p_at: (input.now ?? new Date()).toISOString(),
      }
    : {
        p_classroom_id: input.classroomId,
        p_at: (input.now ?? new Date()).toISOString(),
      }
  const { data, error } = await input.supabase.rpc(rpcName, args)
  if (error) return { state: 'not_configured', scheduleThrough: null }
  const parsed = accessSchema.safeParse(data)
  if (!parsed.success) throw new Error('Attendance classroom access returned an invalid result')
  return {
    state: parsed.data.state,
    scheduleThrough: parsed.data.schedule_through,
  }
}

export async function getBaraAttendanceClassroomAccess(input: {
  supabase: any
  teacherId: string
  classroomId: string
  now?: Date
}): Promise<BaraAttendanceClassroomAccess> {
  if (getBaraAttendanceScopeMode() === 'exact_canary') {
    return {
      state: getBaraAttendanceClassroomIntegrationState(input),
      scheduleThrough: null,
    }
  }
  const transport = getBaraAttendanceIntegrationState()
  if (transport !== 'ready') return { state: transport, scheduleThrough: null }
  return await loadEntitledAccess(input)
}

export async function getBaraAttendanceClassroomIdAccess(input: {
  supabase: any
  classroomId: string
  now?: Date
}): Promise<BaraAttendanceClassroomAccess> {
  if (getBaraAttendanceScopeMode() === 'exact_canary') {
    try {
      await assertBaraAttendanceCanaryClassroomOwner(input)
      return { state: 'ready', scheduleThrough: null }
    } catch (error) {
      if (error instanceof BaraAttendanceCanaryError) {
        return { state: error.code, scheduleThrough: null }
      }
      throw error
    }
  }
  const transport = getBaraAttendanceIntegrationState()
  if (transport !== 'ready') return { state: transport, scheduleThrough: null }
  return await loadEntitledAccess(input)
}

export async function assertBaraAttendanceClassroomAccess(input: {
  supabase: any
  teacherId: string
  classroomId: string
  now?: Date
}) {
  if (getBaraAttendanceScopeMode() === 'exact_canary') {
    assertBaraAttendanceCanaryClassroom({
      teacherId: input.teacherId,
      classroomId: input.classroomId,
    })
    return { state: 'ready' as const, scheduleThrough: null }
  }
  const access = await getBaraAttendanceClassroomAccess(input)
  if (access.state !== 'ready') throw new BaraAttendanceCanaryError(access.state)
  return access
}

export async function assertBaraAttendanceClassroomIdAccess(input: {
  supabase: any
  classroomId: string
  now?: Date
}) {
  const access = await getBaraAttendanceClassroomIdAccess(input)
  if (access.state !== 'ready') throw new BaraAttendanceCanaryError(access.state)
  return access
}
