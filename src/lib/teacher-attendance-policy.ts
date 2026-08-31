import { z } from 'zod'
import { fetchJSON, fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const policySchema = z.object({
  classroomId: z.string(),
  timezone: z.literal('America/Toronto'),
  sessionStartsLocal: localTime,
  sessionEndsLocal: localTime,
  sessionEndDayOffset: z.union([z.literal(0), z.literal(1)]),
  entryOpensMinutesBefore: z.number().int().min(0).max(720),
  presentGraceMinutes: z.number().int().min(0).max(720),
  entryClosesMinutesBeforeEnd: z.number().int().min(0).max(720),
  absentMinutesBeforeEnd: z.number().int().min(0).max(720),
  enabled: z.boolean(),
  revision: z.number().int().safe().positive(),
  updatedAt: z.string().datetime({ offset: true }),
}).strict()

export type TeacherAttendancePolicy = z.infer<typeof policySchema>

const deliveryResultSchema = z.union([
  z.object({ outcome: z.enum(['applied', 'duplicate']), revision: z.number().int().safe().positive() }).strict(),
  z.object({ outcome: z.literal('not_required'), revision: z.literal(0) }).strict(),
])

/** A successful HTTP response alone does not establish schedule acknowledgement. */
export function isTeacherAttendanceScheduleAcknowledged(value: unknown, policy: TeacherAttendancePolicy) {
  const result = z.object({ roster: deliveryResultSchema, schedule: deliveryResultSchema }).strict().safeParse(value)
  return result.success && (!policy.enabled || result.data.schedule.outcome !== 'not_required')
}

const policyCacheKey = (classroomId: string) => `teacher-attendance-policy:${classroomId}`

export function parseTeacherAttendancePolicy(value: unknown, classroomId: string): TeacherAttendancePolicy | null {
  const result = z.object({ policy: policySchema.nullable() }).safeParse(value)
  if (!result.success || (result.data.policy && result.data.policy.classroomId !== classroomId)) {
    throw new Error('Attendance settings are temporarily unavailable')
  }
  return result.data.policy
}

export function invalidateTeacherAttendancePolicy(classroomId: string) {
  invalidateCachedJSON(policyCacheKey(classroomId))
}

export async function readTeacherAttendancePolicy(classroomId: string) {
  return fetchJSONWithCache(policyCacheKey(classroomId), async () => {
    const params = new URLSearchParams({ classroom_id: classroomId })
    const value = await fetchJSON<unknown>(`/api/teacher/attendance/policy?${params}`, {
      errorMessage: 'Attendance settings are temporarily unavailable',
    })
    return parseTeacherAttendancePolicy(value, classroomId)
  })
}

export function formatTeacherAttendancePolicyHours(policy: TeacherAttendancePolicy) {
  const clock = (value: string) => {
    const hours = Number(value.slice(0, 2))
    return `${hours % 12 || 12}:${value.slice(3)} ${hours < 12 ? 'AM' : 'PM'}`
  }
  return `${clock(policy.sessionStartsLocal)} - ${clock(policy.sessionEndsLocal)}${policy.sessionEndDayOffset ? ' (next day)' : ''}`
}
