import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import {
  isClassroomExperienceAdmissionConfigured,
  resolveClassroomExperienceAdmission,
} from '@/lib/server/classroom-experience-admission'
import { getServiceRoleClient } from '@/lib/supabase'
import { compareAnnouncementReadTimestamps } from '@/lib/validations/announcement-reads'
import {
  materialReadClassroomEnvelopeSchema,
  materialReadEnrollmentEnvelopeSchema,
  materialReadMemberEnvelopeSchema,
  materialReadMembershipSchema,
  materialReadOwnerEnvelopeSchema,
  materialReadQuerySchema,
  materialReadRowSchema,
} from '@/lib/validations/material-reads'
import type { AuthenticatedUser } from '@/types'

type Client = ReturnType<typeof getServiceRoleClient>
type Permission = 'owner' | 'member'
type Material = z.infer<typeof materialReadRowSchema>
const PAGE_SIZE = 1000
const materialFields = 'id,classroom_id,title,content,is_draft,released_at,created_by,created_at,updated_at,position,artifact_id,source_artifact_id,blueprint_archived_at,source_blueprint_version_id'
const ownerSelect = `id,teacher_id,archived_at,materials:classwork_materials!classwork_materials_classroom_id_fkey(${materialFields})`
const memberSelect = `${ownerSelect},membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner(classroom_id,student_id)`
const unavailable = () => new ApiError(503, 'Unable to verify classroom materials')

/** Authentication precedes cohort parsing; admission grants no classroom relationship. */
export async function authorizeSharedMaterialReadActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  if (resolveClassroomExperienceAdmission(user).status !== 'admitted') return { mode: 'existing' }
  return { mode: 'shared', user }
}

function cursorFilter(row: Material, permission: Permission): string {
  const position = `position.gt.${row.position}`
  const samePosition = `position.eq.${row.position}`
  if (permission === 'owner') {
    return `${position},and(${samePosition},created_at.gt.${row.created_at}),and(${samePosition},created_at.eq.${row.created_at},id.gt.${row.id})`
  }
  return row.released_at === null
    ? `${position},and(${samePosition},released_at.is.null,id.gt.${row.id})`
    : `${position},and(${samePosition},released_at.gt.${row.released_at}),and(${samePosition},released_at.is.null),and(${samePosition},released_at.eq.${row.released_at},id.gt.${row.id})`
}

function follows(previous: Material, next: Material, permission: Permission): boolean {
  if (previous.position !== next.position) return next.position > previous.position
  if (permission === 'member') {
    if (previous.released_at === null && next.released_at !== null) return false
    if (previous.released_at !== null && next.released_at === null) return true
  }
  const previousTime = permission === 'owner' ? previous.created_at : previous.released_at
  const nextTime = permission === 'owner' ? next.created_at : next.released_at
  const comparison = previousTime === null || nextTime === null
    ? 0 : compareAnnouncementReadTimestamps(previousTime, nextTime)
  return comparison < 0 || (comparison === 0 && next.id > previous.id)
}

/** Every payload page, including the terminal empty page, independently proves the current relationship. */
export async function readContextualMaterials(input: {
  supabase: Client; actorId: string; classroomId: string; permission: Permission
}) {
  const parsed = materialReadQuerySchema.safeParse({ actorId: input.actorId, classroomId: input.classroomId })
  if (!parsed.success) throw new ApiError(400, 'Invalid material query')
  const { actorId, classroomId } = parsed.data
  let preflightResult: unknown
  try {
    preflightResult = await input.supabase.from('classrooms')
      .select('id,teacher_id,archived_at').eq('id', classroomId).maybeSingle()
  } catch { throw unavailable() }
  const preflight = materialReadClassroomEnvelopeSchema.safeParse(preflightResult)
  if (!preflight.success) throw unavailable()
  const classroom = preflight.data.data
  if (classroom === null) throw new ApiError(404, 'Classroom not found')
  if (classroom.id !== classroomId) throw unavailable()
  if (input.permission === 'owner') {
    if (classroom.teacher_id !== actorId) throw new ApiError(403, 'Forbidden')
  } else {
    if (classroom.teacher_id === actorId || classroom.archived_at !== null) throw new ApiError(403, 'Forbidden')
    let enrollmentResult: unknown
    try {
      enrollmentResult = await input.supabase.from('classroom_enrollments')
        .select('classroom_id,student_id').eq('classroom_id', classroomId)
        .eq('student_id', actorId).maybeSingle()
    } catch { throw unavailable() }
    const enrollment = materialReadEnrollmentEnvelopeSchema.safeParse(enrollmentResult)
    if (!enrollment.success) throw unavailable()
    if (enrollment.data.data === null) throw new ApiError(403, 'Forbidden')
    if (enrollment.data.data.classroom_id !== classroomId || enrollment.data.data.student_id !== actorId) throw unavailable()
  }

  const materials: Material[] = []
  const seen = new Set<string>()
  let previous: Material | undefined
  for (;;) {
    let pageResult: unknown
    try {
      let query = input.supabase.from('classrooms')
        .select(input.permission === 'owner' ? ownerSelect : memberSelect).eq('id', classroomId)
      if (input.permission === 'owner') {
        query = query.eq('teacher_id', actorId)
      } else {
        query = query.neq('teacher_id', actorId).is('archived_at', null)
          .eq('membership.student_id', actorId).eq('materials.is_draft', false)
      }
      if (previous) query = query.or(cursorFilter(previous, input.permission), { referencedTable: 'materials' })
      query = query.order('position', { ascending: true, referencedTable: 'materials' })
      query = input.permission === 'owner'
        ? query.order('created_at', { ascending: true, referencedTable: 'materials' })
        : query.order('released_at', { ascending: true, nullsFirst: false, referencedTable: 'materials' })
      pageResult = await query.order('id', { ascending: true, referencedTable: 'materials' })
        .limit(PAGE_SIZE, { referencedTable: 'materials' }).maybeSingle()
    } catch { throw unavailable() }
    const envelope = (input.permission === 'owner' ? materialReadOwnerEnvelopeSchema : materialReadMemberEnvelopeSchema).safeParse(pageResult)
    if (!envelope.success) throw unavailable()
    const row = envelope.data.data
    if (row === null) throw new ApiError(403, 'Forbidden')
    const membership = input.permission === 'member'
      ? materialReadMembershipSchema.safeParse('membership' in row ? row.membership : undefined) : null
    if (row.id !== classroomId || (input.permission === 'owner'
      ? row.teacher_id !== actorId
      : row.teacher_id === actorId || row.archived_at !== null || !membership?.success
        || membership.data.some(member => member.classroom_id !== classroomId || member.student_id !== actorId))) throw unavailable()
    for (const material of row.materials) {
      if (material.classroom_id !== classroomId || seen.has(material.id)
        || (previous && !follows(previous, material, input.permission))
        || (input.permission === 'member' && material.is_draft)) throw unavailable()
      seen.add(material.id)
      materials.push(material)
      previous = material
    }
    if (row.materials.length === 0) break
  }
  return { materials }
}
