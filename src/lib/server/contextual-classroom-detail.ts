import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import type { getServiceRoleClient } from '@/lib/supabase'
import {
  isClassroomExperienceAdmissionConfigured,
  resolveClassroomExperienceAdmission,
} from '@/lib/server/classroom-experience-admission'
import { classroomStudentRecord, hydrateClassroomRecord } from '@/lib/server/classrooms'
import {
  contextualClassroomDetailClassroomEnvelopeSchema,
  contextualClassroomDetailMemberEnvelopeSchema,
  contextualClassroomDetailOwnerEnvelopeSchema,
  contextualClassroomDetailQuerySchema,
} from '@/lib/validations/contextual-classroom-detail'
import type { AuthenticatedUser } from '@/types'

type Client = ReturnType<typeof getServiceRoleClient>
const classroomSelect = 'id,teacher_id,title,class_code,term_label,allow_enrollment,join_policy,archived_at,created_at,updated_at,start_date,end_date,position,theme_color,lesson_plan_visibility,blueprint_source_revision,source_blueprint_id,source_blueprint_origin,source_blueprint_version_id,authoring_guidance_version_id,actual_site_slug,actual_site_published,actual_site_config,feature_visibility,course_overview_markdown,course_outline_markdown,manual_attendance_revision,manual_attendance_session_starts_local,manual_attendance_session_ends_local,manual_attendance_source_mode'
const memberSelect = `${classroomSelect},membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner(classroom_id,student_id)`
const unavailable = () => new ApiError(503, 'Unable to verify classroom details')

/** Authenticate before params, then make exactly one shared admission decision. */
export async function authorizeSharedClassroomDetailReadActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  if (resolveClassroomExperienceAdmission(user).status !== 'admitted') return { mode: 'existing' }
  return { mode: 'shared', user }
}

/** The preflight classifies denials; only the actor-bound payload proves access. */
export async function readContextualClassroomDetail(input: {
  supabase: Client; actorId: string; classroomId: string; permission: 'owner' | 'member'
}) {
  const parsed = contextualClassroomDetailQuerySchema.safeParse({
    actorId: input.actorId, classroomId: input.classroomId, permission: input.permission,
  })
  if (!parsed.success) throw new ApiError(400, 'Invalid classroom detail query')
  const { actorId, classroomId, permission } = parsed.data
  let preflightResult: unknown
  try {
    preflightResult = await input.supabase.from('classrooms')
      .select('id,teacher_id,archived_at').eq('id', classroomId).maybeSingle()
  } catch { throw unavailable() }
  const preflight = contextualClassroomDetailClassroomEnvelopeSchema.safeParse(preflightResult)
  if (!preflight.success) throw unavailable()
  const first = preflight.data.data
  if (first === null) throw new ApiError(404, 'Classroom not found')
  if (first.id !== classroomId) throw unavailable()
  if (permission === 'owner' ? first.teacher_id !== actorId : first.teacher_id === actorId || first.archived_at !== null) {
    throw new ApiError(403, 'Forbidden')
  }

  if (permission === 'owner') {
    let payloadResult: unknown
    try {
      payloadResult = await input.supabase.from('classrooms').select(classroomSelect)
        .eq('id', classroomId).eq('teacher_id', actorId).maybeSingle()
    } catch { throw unavailable() }
    const envelope = contextualClassroomDetailOwnerEnvelopeSchema.safeParse(payloadResult)
    if (!envelope.success) throw unavailable()
    const row = envelope.data.data
    if (row === null) throw new ApiError(403, 'Forbidden')
    if (row.id !== classroomId || row.teacher_id !== actorId) throw unavailable()
    return hydrateClassroomRecord(row)
  }

  let payloadResult: unknown
  try {
    payloadResult = await input.supabase.from('classrooms').select(memberSelect)
      .eq('id', classroomId).neq('teacher_id', actorId).is('archived_at', null)
      .eq('membership.classroom_id', classroomId).eq('membership.student_id', actorId).maybeSingle()
  } catch { throw unavailable() }
  const envelope = contextualClassroomDetailMemberEnvelopeSchema.safeParse(payloadResult)
  if (!envelope.success) throw unavailable()
  const root = envelope.data.data
  if (root === null) throw new ApiError(403, 'Forbidden')
  if (root.id !== classroomId || root.teacher_id === actorId || root.archived_at !== null) throw unavailable()
  const { membership, ...row } = root
  if (membership[0].classroom_id !== classroomId || membership[0].student_id !== actorId) throw unavailable()
  return hydrateClassroomRecord({
    ...classroomStudentRecord(row), course_overview_markdown: '', course_outline_markdown: '',
  })
}
