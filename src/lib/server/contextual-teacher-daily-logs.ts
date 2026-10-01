import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import { getServiceRoleClient } from '@/lib/supabase'
import { contextualTeacherLogsQuerySchema } from '@/lib/validations/teacher-logs'

type ServiceClient = ReturnType<typeof getServiceRoleClient>
const PAGE_SIZE = 1000
const PREVIEW_LIMIT = 5
const uuid = z.string().uuid().transform(value => value.toLowerCase())
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const timestamp = z.string().datetime({ offset: true })
const entrySchema = z.object({
  id: uuid, student_id: uuid, classroom_id: uuid, date,
  text: z.string(), rich_content: z.unknown().nullable(), version: z.number().int(),
  minutes_reported: z.number().nullable(), mood: z.string().nullable(),
  created_at: timestamp, updated_at: timestamp, on_time: z.boolean(),
})
const enrollmentSchema = z.object({
  id: uuid, classroom_id: uuid, student_id: uuid,
  classroom: z.object({ id: uuid, teacher_id: uuid }),
  learner: z.object({
    id: uuid, email: z.string(),
    profile: z.object({ id: uuid, user_id: uuid, first_name: z.string(), last_name: z.string() }).nullable(),
    selected: z.array(entrySchema).max(1), preview: z.array(entrySchema).max(PREVIEW_LIMIT),
  }),
})
const pageSchema = z.array(enrollmentSchema).max(PAGE_SIZE)
const queryResultSchema = z.object({ data: pageSchema, error: z.null() })
const select = `
  id, classroom_id, student_id,
  classroom:classrooms!inner(id, teacher_id),
  learner:users!classroom_enrollments_student_id_fkey(
    id, email,
    profile:student_profiles!student_profiles_user_id_fkey(id, user_id, first_name, last_name),
    selected:entries!entries_student_id_fkey(id, student_id, classroom_id, date, text, rich_content, version, minutes_reported, mood, created_at, updated_at, on_time),
    preview:entries!entries_student_id_fkey(id, student_id, classroom_id, date, text, rich_content, version, minutes_reported, mood, created_at, updated_at, on_time)
  )
`

function unavailable(): ApiError {
  return new ApiError(503, 'Unable to verify Daily Log roster')
}

/** Each roster page binds the current owner, enrollment and nested entries in one statement. */
export async function readContextualTeacherLogs(input: {
  supabase: ServiceClient; actorId: string; classroomId: string; date?: string
}) {
  const actor = uuid.safeParse(input.actorId)
  const queryInput = contextualTeacherLogsQuerySchema.safeParse({
    classroom_id: input.classroomId, date: input.date,
  })
  if (!actor.success || !queryInput.success) throw new ApiError(400, 'Invalid Daily Log query')
  const actorId = actor.data
  const classroomId = queryInput.data.classroom_id.toLowerCase()
  const selectedDate = queryInput.data.date

  let context: Awaited<ReturnType<typeof resolveClassroomAccess>>
  try {
    context = await resolveClassroomAccess(actorId, classroomId, { supabase: input.supabase })
  } catch {
    throw unavailable()
  }
  if (context === null) throw new ApiError(404, 'Classroom not found')
  if (context.classroomId !== classroomId || context.userId !== actorId) throw unavailable()
  if (context.relationship !== 'owner') throw new ApiError(403, 'Forbidden')
  if (context.ownerId !== actorId) throw unavailable()

  const logs: Array<{
    student_id: string; student_email: string; student_first_name: string;
    student_last_name: string; entry: z.infer<typeof entrySchema> | null;
    history_preview: Array<z.infer<typeof entrySchema>>
  }> = []
  let lastId: string | undefined
  const seenStudents = new Set<string>()
  for (;;) {
    let result: unknown
    try {
      let query = input.supabase.from('classroom_enrollments')
        .select(select)
        .eq('classroom_id', classroomId)
        .eq('classroom.teacher_id', actorId)
        .eq('learner.selected.classroom_id', classroomId)
        .eq('learner.preview.classroom_id', classroomId)
      if (selectedDate) query = query.eq('learner.selected.date', selectedDate)
      if (lastId) query = query.gt('id', lastId)
      result = await query
        .order('id', { ascending: true })
        .order('date', { ascending: false, referencedTable: 'learner.preview' })
        .order('updated_at', { ascending: false, referencedTable: 'learner.preview' })
        .limit(selectedDate ? 1 : 0, { referencedTable: 'learner.selected' })
        .limit(PREVIEW_LIMIT, { referencedTable: 'learner.preview' })
        .limit(PAGE_SIZE)
    } catch {
      throw unavailable()
    }
    const envelope = queryResultSchema.safeParse(result)
    if (!envelope.success) throw unavailable()
    const page = envelope.data.data
    for (const row of page) {
      if (row.classroom_id !== classroomId || row.classroom.id !== classroomId
        || row.classroom.teacher_id !== actorId || row.student_id !== row.learner.id
        || (lastId !== undefined && row.id <= lastId) || seenStudents.has(row.student_id)
        || (row.learner.profile !== null && row.learner.profile.user_id !== row.student_id)) {
        throw unavailable()
      }
      for (const entry of [...row.learner.selected, ...row.learner.preview]) {
        if (entry.classroom_id !== classroomId || entry.student_id !== row.student_id
          || !Object.hasOwn(entry, 'rich_content')) throw unavailable()
      }
      if ((!selectedDate && row.learner.selected.length !== 0)
        || (selectedDate && row.learner.selected.some(entry => entry.date !== selectedDate))) {
        throw unavailable()
      }
      const preview = row.learner.preview
      for (let index = 1; index < preview.length; index++) {
        const previous = preview[index - 1]
        const current = preview[index]
        if (previous.date < current.date || (previous.date === current.date
          && previous.updated_at < current.updated_at)) throw unavailable()
      }
      seenStudents.add(row.student_id)
      lastId = row.id
      logs.push({
        student_id: row.student_id,
        student_email: row.learner.email,
        student_first_name: row.learner.profile?.first_name ?? '',
        student_last_name: row.learner.profile?.last_name ?? '',
        entry: row.learner.selected[0] ?? null,
        history_preview: preview,
      })
    }
    if (page.length < PAGE_SIZE) break
    if (!lastId) throw unavailable()
  }
  logs.sort((a, b) => a.student_email.localeCompare(b.student_email)
    || a.student_id.localeCompare(b.student_id))
  return { classroom_id: classroomId, date: selectedDate ?? null, logs }
}
