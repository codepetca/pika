import { format } from 'date-fns'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import {
  isClassroomExperienceAdmissionConfigured,
  resolveClassroomExperienceAdmission,
} from '@/lib/server/classroom-experience-admission'
import { getServiceRoleClient } from '@/lib/supabase'
import { nowInToronto } from '@/lib/timezone'
import { isValidTiptapContent, parseContentField } from '@/lib/tiptap-content'
import {
  lessonPlanReadClassroomEnvelopeSchema,
  lessonPlanReadEnrollmentEnvelopeSchema,
  lessonPlanReadMemberEnvelopeSchema,
  lessonPlanReadMembershipSchema,
  lessonPlanReadOwnerEnvelopeSchema,
  lessonPlanReadPlanSchema,
  lessonPlanReadQuerySchema,
  lessonPlanReadVisibilitySchema,
} from '@/lib/validations/lesson-plan-reads'
import type { AuthenticatedUser } from '@/types'

type Client = ReturnType<typeof getServiceRoleClient>
type Permission = 'owner' | 'member'
const PAGE_SIZE = 1000
const uuid = z.string().uuid().transform(value => value.toLowerCase())
const selectPlanFields = 'id,classroom_id,date,content,content_markdown,created_at,updated_at,artifact_id,source_artifact_id,source_blueprint_version_id,blueprint_archived_at'
const ownerSelect = `id,teacher_id,archived_at,lesson_plan_visibility,plans:lesson_plans!lesson_plans_classroom_id_fkey(${selectPlanFields})`
const memberSelect = `${ownerSelect},membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner(classroom_id,student_id)`

function unavailable(): ApiError {
  return new ApiError(503, 'Unable to verify classroom lesson plans')
}

/** Shared admission is checked only after authentication and never substitutes for relationship proof. */
export async function authorizeSharedLessonPlanReadActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) {
    return { mode: 'existing' }
  }
  const user = await requireAuth()
  if (resolveClassroomExperienceAdmission(user).status !== 'admitted') {
    return { mode: 'existing' }
  }
  return { mode: 'shared', user }
}

function maxAllowedDate(visibility: z.infer<typeof lessonPlanReadVisibilitySchema>, now: Date): string | null {
  if (visibility === 'all') return null
  const endOfWeek = new Date(now)
  endOfWeek.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7) + (visibility === 'one_week_ahead' ? 7 : 0))
  return format(endOfWeek, 'yyyy-MM-dd')
}

/** Every page is a fresh actor-bound root query. The terminal empty page also checks relationship and visibility. */
export async function readContextualLessonPlans(input: {
  supabase: Client; actorId: string; classroomId: string; start: string; end: string;
  permission: Permission; now?: Date
}) {
  const actor = uuid.safeParse(input.actorId)
  const parsed = lessonPlanReadQuerySchema.safeParse({ classroomId: input.classroomId, start: input.start, end: input.end })
  if (!actor.success || !parsed.success) throw new ApiError(400, 'Invalid lesson-plan query')
  const classroomId = parsed.data.classroomId.toLowerCase()
  const { start, end } = parsed.data
  let classroomResult: unknown
  try {
    classroomResult = await input.supabase.from('classrooms')
      .select('id,teacher_id,archived_at').eq('id', classroomId).maybeSingle()
  } catch {
    throw unavailable()
  }
  const preflight = lessonPlanReadClassroomEnvelopeSchema.safeParse(classroomResult)
  if (!preflight.success) throw unavailable()
  const classroom = preflight.data.data
  if (classroom === null) throw new ApiError(404, 'Classroom not found')
  if (classroom.id !== classroomId) throw unavailable()
  if (input.permission === 'owner') {
    if (classroom.teacher_id !== actor.data) throw new ApiError(403, 'Forbidden')
  } else {
    if (classroom.teacher_id === actor.data || classroom.archived_at !== null) throw new ApiError(403, 'Forbidden')
    let enrollmentResult: unknown
    try {
      enrollmentResult = await input.supabase.from('classroom_enrollments')
        .select('classroom_id,student_id')
        .eq('classroom_id', classroomId)
        .eq('student_id', actor.data)
        .maybeSingle()
    } catch {
      throw unavailable()
    }
    const enrollment = lessonPlanReadEnrollmentEnvelopeSchema.safeParse(enrollmentResult)
    if (!enrollment.success) throw unavailable()
    if (enrollment.data.data === null) throw new ApiError(403, 'Forbidden')
    if (enrollment.data.data.classroom_id !== classroomId || enrollment.data.data.student_id !== actor.data) throw unavailable()
  }
  const now = input.now ?? nowInToronto()
  if (Number.isNaN(now.getTime())) throw unavailable()
  const plans: Array<z.infer<typeof lessonPlanReadPlanSchema>> = []
  const seenPlanIds = new Set<string>()
  let lastDate: string | undefined
  let firstVisibility: z.infer<typeof lessonPlanReadVisibilitySchema> | undefined
  let firstMaxDate: string | null | undefined
  for (;;) {
    let result: unknown
    try {
      let query = input.supabase.from('classrooms')
        .select(input.permission === 'owner' ? ownerSelect : memberSelect)
        .eq('id', classroomId)
      if (input.permission === 'owner') {
        query = query.eq('teacher_id', actor.data)
      } else {
        query = query.neq('teacher_id', actor.data)
          .is('archived_at', null)
          .eq('membership.student_id', actor.data)
      }
      query = query.gte('plans.date', start)
      const effectiveEnd = input.permission === 'member' && firstMaxDate && firstMaxDate < end
        ? firstMaxDate : end
      query = query.lte('plans.date', effectiveEnd)
      if (lastDate) query = query.gt('plans.date', lastDate)
      result = await query.order('date', { ascending: true, referencedTable: 'plans' })
        .limit(PAGE_SIZE, { referencedTable: 'plans' })
        .maybeSingle()
    } catch {
      throw unavailable()
    }
    const envelope = (input.permission === 'owner' ? lessonPlanReadOwnerEnvelopeSchema : lessonPlanReadMemberEnvelopeSchema).safeParse(result)
    if (!envelope.success) throw unavailable()
    const row = envelope.data.data
    if (row === null) {
      throw new ApiError(403, 'Forbidden')
    }
    const membership = input.permission === 'member'
      ? lessonPlanReadMembershipSchema.safeParse((row as { membership?: unknown }).membership)
      : null
    if (row.id !== classroomId || (input.permission === 'owner'
      ? row.teacher_id !== actor.data
      : row.teacher_id === actor.data || row.archived_at !== null
        || !membership?.success || membership.data.some(member => member.classroom_id !== classroomId || member.student_id !== actor.data))) {
      throw unavailable()
    }
    if (input.permission === 'member') {
      const rawVisibility = row.lesson_plan_visibility
      const visibility = rawVisibility ?? 'current_week'
      const maxDate = maxAllowedDate(visibility, now)
      if (firstVisibility !== undefined && (firstVisibility !== rawVisibility || firstMaxDate !== maxDate)) throw unavailable()
      if (firstVisibility === undefined) {
        firstVisibility = rawVisibility
        firstMaxDate = maxDate
      }
    }
    const page = row.plans
    let previous = lastDate
    for (const plan of page) {
      if (plan.classroom_id !== classroomId || plan.date < start || plan.date > end
        || (previous !== undefined && plan.date <= previous)
        || seenPlanIds.has(plan.id)) throw unavailable()
      if (typeof plan.content === 'string') {
        try { JSON.parse(plan.content) } catch { throw unavailable() }
      }
      if (!isValidTiptapContent(parseContentField(plan.content))) throw unavailable()
      previous = plan.date
      seenPlanIds.add(plan.id)
      if (firstMaxDate === null || firstMaxDate === undefined || plan.date <= firstMaxDate) plans.push(plan)
    }
    if (page.length === 0) break
    lastDate = previous
  }
  const lesson_plans = plans.map(plan => ({ ...plan, content_markdown: getLessonPlanMarkdown({
    content: parseContentField(plan.content),
    content_markdown: plan.content_markdown,
  }).markdown }))
  return input.permission === 'owner' ? { lesson_plans } : {
    lesson_plans, visibility: firstVisibility ?? 'current_week', max_date: firstMaxDate!,
  }
}
