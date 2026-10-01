import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import {
  isClassroomExperienceAdmissionConfigured,
  resolveClassroomExperienceAdmission,
} from '@/lib/server/classroom-experience-admission'
import type { AuthenticatedUser } from '@/types'

type DailyLogReadActor = { mode: 'legacy' | 'contextual'; user: AuthenticatedUser }
const uuid = z.string().uuid()
const readRowSchema = z.object({
  id: uuid, student_id: uuid, classroom_id: uuid, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  classroom: z.object({
    id: uuid, teacher_id: uuid, archived_at: z.null(),
    membership: z.array(z.object({ classroom_id: uuid, student_id: uuid })).min(1),
  }),
}).passthrough()

/** Authentication precedes admission parsing and query parsing, including broad reads. */
export async function authorizeDailyLogReadActor(): Promise<DailyLogReadActor> {
  if (!isClassroomExperienceAdmissionConfigured()) {
    return { mode: 'legacy', user: await requireRole('student') }
  }
  const user = await requireAuth()
  if (resolveClassroomExperienceAdmission(user).status === 'not-admitted') {
    if (user.role !== 'student') throw new AuthorizationError('Forbidden: student role required')
    return { mode: 'legacy', user }
  }
  return { mode: 'contextual', user: { ...user, id: user.id.toLowerCase() } }
}

/**
 * The entry and current membership/lifecycle are selected in one DB statement.
 * Do not precompute an enrollment-ID list: it can go stale before the entry read.
 * A scoped preflight preserves explicit missing/forbidden statuses; the joined
 * query remains authoritative if removal or archive wins after that preflight.
 */
export async function readContextualDailyLogs(input: {
  supabase: ReturnType<typeof getServiceRoleClient>
  actorId: string
  classroomId: string | null
  limit: number | null
}) {
  const { supabase, actorId, limit } = input
  const requestedId = input.classroomId === null ? null : uuid.safeParse(input.classroomId)
  if (requestedId && !requestedId.success) throw new ApiError(400, 'Invalid classroom identifier')
  const classroomId = requestedId?.success ? requestedId.data.toLowerCase() : null
  if (classroomId !== null) {
    const context = await resolveClassroomAccess(actorId, classroomId, { supabase })
    if (context === null) throw new ApiError(404, 'Classroom not found')
    if (context.relationship !== 'member' || context.archived) throw new ApiError(403, 'Forbidden')
  }

  let query = supabase.from('entries')
    .select('*, classroom:classrooms!inner(id, teacher_id, archived_at, membership:classroom_enrollments!inner(classroom_id, student_id))')
    .eq('student_id', actorId)
    .eq('classroom.membership.student_id', actorId)
    .is('classroom.archived_at', null)
    .neq('classroom.teacher_id', actorId)
  if (classroomId !== null) query = query.eq('classroom_id', classroomId)
  if (limit !== null) query = query.limit(limit)
  const { data, error } = await query.order('date', { ascending: false })
  const rows = z.array(readRowSchema).safeParse(data)
  if (error || !rows.success || rows.data.some((row) => (
    row.student_id !== actorId
    || (classroomId !== null && row.classroom_id !== classroomId)
    || row.classroom.id !== row.classroom_id
    || row.classroom.teacher_id === actorId
    || row.classroom.membership.some((membership) => (
      membership.student_id !== actorId || membership.classroom_id !== row.classroom_id
    ))
  ))) {
    throw new ApiError(503, 'Unable to verify Daily Log entries')
  }
  return rows.data.map(({ classroom: _classroom, ...entry }) => entry)
}
