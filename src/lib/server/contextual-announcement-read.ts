import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import {
  isClassroomExperienceAdmissionConfigured,
  resolveClassroomExperienceAdmission,
} from '@/lib/server/classroom-experience-admission'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  announcementReadClassroomEnvelopeSchema,
  announcementReadEnrollmentEnvelopeSchema,
  announcementReadMemberEnvelopeSchema,
  announcementReadMembershipSchema,
  announcementReadOwnerEnvelopeSchema,
  announcementReadQuerySchema,
  announcementReadRowSchema,
  compareAnnouncementReadTimestamps,
} from '@/lib/validations/announcement-reads'
import type { AuthenticatedUser } from '@/types'

type Client = ReturnType<typeof getServiceRoleClient>
type Permission = 'owner' | 'member'
type Announcement = z.infer<typeof announcementReadRowSchema>
const uuid = z.string().uuid().transform(value => value.toLowerCase())
const PAGE_SIZE = 1000
const announcementFields = 'id,classroom_id,title,content,created_by,is_draft,published_at,scheduled_for,created_at,updated_at'
const ownerSelect = `id,teacher_id,archived_at,announcements:announcements!announcements_classroom_id_fkey(${announcementFields})`
const memberSelect = `${ownerSelect},membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner(classroom_id,student_id)`
const unavailable = () => new ApiError(503, 'Unable to verify classroom announcements')

/** Admission is resolved after authentication and grants no classroom relationship. */
export async function authorizeSharedAnnouncementReadActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  if (resolveClassroomExperienceAdmission(user).status !== 'admitted') return { mode: 'existing' }
  return { mode: 'shared', user }
}

function cursorFilter(row: Announcement): string {
  return row.published_at === null
    ? `and(published_at.is.null,id.gt.${row.id}),published_at.not.is.null`
    : `published_at.lt.${row.published_at},and(published_at.eq.${row.published_at},id.gt.${row.id})`
}

function follows(previous: Announcement, next: Announcement): boolean {
  if (previous.published_at === null && next.published_at !== null) return true
  if (previous.published_at !== null && next.published_at === null) return false
  const comparison = previous.published_at === null || next.published_at === null
    ? 0 : compareAnnouncementReadTimestamps(previous.published_at, next.published_at)
  return comparison > 0 || (comparison === 0 && next.id > previous.id)
}

/** Every page, including the terminal empty page, independently proves the current relationship. */
export async function readContextualAnnouncements(input: {
  supabase: Client; actorId: string; classroomId: string; permission: Permission; now?: Date
}) {
  const actor = uuid.safeParse(input.actorId)
  const parsed = announcementReadQuerySchema.safeParse({ classroomId: input.classroomId })
  if (!actor.success || !parsed.success) throw new ApiError(400, 'Invalid announcement query')
  const actorId = actor.data
  const { classroomId } = parsed.data
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw unavailable()
  // Capture once before any database wait so scheduling eligibility cannot expand across pages.
  const cutoff = now.toISOString()
  let preflightResult: unknown
  try {
    preflightResult = await input.supabase.from('classrooms')
      .select('id,teacher_id,archived_at').eq('id', classroomId).maybeSingle()
  } catch { throw unavailable() }
  const preflight = announcementReadClassroomEnvelopeSchema.safeParse(preflightResult)
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
    const enrollment = announcementReadEnrollmentEnvelopeSchema.safeParse(enrollmentResult)
    if (!enrollment.success) throw unavailable()
    if (enrollment.data.data === null) throw new ApiError(403, 'Forbidden')
    if (enrollment.data.data.classroom_id !== classroomId || enrollment.data.data.student_id !== actorId) throw unavailable()
  }

  const announcements: Announcement[] = []
  const seen = new Set<string>()
  let previous: Announcement | undefined
  for (;;) {
    let pageResult: unknown
    try {
      let query = input.supabase.from('classrooms')
        .select(input.permission === 'owner' ? ownerSelect : memberSelect).eq('id', classroomId)
      if (input.permission === 'owner') {
        query = query.eq('teacher_id', actorId)
        if (previous) query = query.or(cursorFilter(previous), { referencedTable: 'announcements' })
      } else {
        query = query.neq('teacher_id', actorId).is('archived_at', null)
          .eq('membership.student_id', actorId).eq('announcements.is_draft', false)
        const scheduling = `scheduled_for.is.null,scheduled_for.lte.${cutoff}`
        // PostgREST replaces repeated alias .or calls, so combine scheduling and cursor in one filter.
        const filter = previous ? `and(or(${scheduling}),or(${cursorFilter(previous)}))` : scheduling
        query = query.or(filter, { referencedTable: 'announcements' })
      }
      pageResult = await query
        .order('published_at', { ascending: false, nullsFirst: true, referencedTable: 'announcements' })
        .order('id', { ascending: true, referencedTable: 'announcements' })
        .limit(PAGE_SIZE, { referencedTable: 'announcements' }).maybeSingle()
    } catch { throw unavailable() }
    const envelope = (input.permission === 'owner' ? announcementReadOwnerEnvelopeSchema : announcementReadMemberEnvelopeSchema).safeParse(pageResult)
    if (!envelope.success) throw unavailable()
    const row = envelope.data.data
    if (row === null) throw new ApiError(403, 'Forbidden')
    const membership = input.permission === 'member'
      ? announcementReadMembershipSchema.safeParse((row as { membership?: unknown }).membership) : null
    if (row.id !== classroomId || (input.permission === 'owner'
      ? row.teacher_id !== actorId
      : row.teacher_id === actorId || row.archived_at !== null || !membership?.success
        || membership.data.some(member => member.classroom_id !== classroomId || member.student_id !== actorId))) throw unavailable()
    const page = row.announcements
    for (const announcement of page) {
      if (announcement.classroom_id !== classroomId || seen.has(announcement.id)
        || (previous && !follows(previous, announcement))
        || (input.permission === 'member' && (announcement.is_draft
          || (announcement.scheduled_for !== null && compareAnnouncementReadTimestamps(announcement.scheduled_for, cutoff) > 0)))) throw unavailable()
      seen.add(announcement.id)
      announcements.push(announcement)
      previous = announcement
    }
    if (page.length === 0) break
  }
  return { announcements }
}
