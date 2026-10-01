import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { LOG_SUMMARY_POLICY_VERSION, restoreNames } from '@/lib/log-summary'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  teacherLogSummaryCacheResultSchema,
  teacherLogSummaryCountResultSchema,
  teacherLogSummaryCurrentItemsSchema,
  teacherLogSummaryInitialsMapSchema,
  teacherLogSummaryPreflightResultSchema,
  teacherLogSummaryQuerySchema,
  teacherLogSummaryStatsResultSchema,
} from '@/lib/validations/teacher-log-summary'

type ServiceClient = ReturnType<typeof getServiceRoleClient>
const failure = () => new ApiError(503, 'Unable to verify Daily Log summary')
const uuid = z.string().uuid().transform((value) => value.toLowerCase())
const joinedClassroom = 'classroom:classrooms!inner(id,teacher_id)'

/** Every data statement checks current ownership; the preflight only retains 404/403 semantics. */
export async function readContextualTeacherLogSummary(input: {
  supabase: ServiceClient; actorId: string; classroomId: string; date: string
}) {
  const actor = uuid.safeParse(input.actorId)
  const query = teacherLogSummaryQuerySchema.safeParse(input)
  if (!actor.success || !query.success) throw new ApiError(400, 'Invalid Daily Log summary query')
  const { classroomId, date } = query.data
  const actorId = actor.data
  const { supabase } = input

  let preflightResult: unknown
  try {
    preflightResult = await supabase.from('classrooms')
      .select('id,teacher_id,archived_at').eq('id', classroomId).maybeSingle()
  } catch { throw failure() }
  const preflight = teacherLogSummaryPreflightResultSchema.safeParse(preflightResult)
  if (!preflight.success) throw failure()
  if (preflight.data.data === null) throw new ApiError(404, 'Classroom not found')
  const classroom = preflight.data.data
  if (classroom.id !== classroomId) throw failure()
  if (classroom.teacher_id !== actorId) throw new ApiError(403, 'Forbidden')

  let statsResult: unknown
  try {
    statsResult = await supabase.from('entries')
      .select(`classroom_id,date,updated_at,${joinedClassroom}`)
      .eq('classroom_id', classroomId).eq('date', date)
      .eq('classroom.teacher_id', actorId)
      .order('updated_at', { ascending: false }).limit(1)
  } catch { throw failure() }
  const stats = teacherLogSummaryStatsResultSchema.safeParse(statsResult)
  if (!stats.success || stats.data.data.some((row) => row.classroom_id !== classroomId
    || row.date !== date || row.classroom.id !== classroomId
    || row.classroom.teacher_id !== actorId)) throw failure()

  let countResult: unknown
  try {
    countResult = await supabase.from('entries')
      .select(`classroom_id,date,${joinedClassroom}`, { count: 'exact', head: true })
      .eq('classroom_id', classroomId).eq('date', date)
      .eq('classroom.teacher_id', actorId)
  } catch { throw failure() }
  const count = teacherLogSummaryCountResultSchema.safeParse(countResult)
  if (!count.success) throw failure()
  const actualEntryCount = count.data.count
  if (actualEntryCount === 0) {
    return { summary: null, summary_status: 'no_entries' as const }
  }
  if (stats.data.data.length === 0) throw failure()
  const maxUpdatedAt = Date.parse(stats.data.data[0].updated_at)

  let cacheResult: unknown
  try {
    cacheResult = await supabase.from('log_summaries')
      .select(`id,classroom_id,date,summary_items,initials_map,entry_count,entries_updated_at,generated_at,${joinedClassroom}`)
      .eq('classroom_id', classroomId).eq('date', date)
      .eq('classroom.teacher_id', actorId).maybeSingle()
  } catch { throw failure() }
  const parsedCache = teacherLogSummaryCacheResultSchema.safeParse(cacheResult)
  if (!parsedCache.success) throw failure()
  if (parsedCache.data.data === null) return { summary: null, summary_status: 'pending' as const }
  const cached = parsedCache.data.data
  if (cached.classroom_id !== classroomId || cached.date !== date
    || cached.classroom.id !== classroomId || cached.classroom.teacher_id !== actorId) throw failure()

  const rawItems = cached.summary_items
  const hasCurrentPolicy = rawItems !== null && typeof rawItems === 'object'
    && !Array.isArray(rawItems) && 'policy_version' in rawItems
    && rawItems.policy_version === LOG_SUMMARY_POLICY_VERSION
  if (!hasCurrentPolicy) return { summary: null, summary_status: 'unavailable' as const }
  if (!('overview' in rawItems)) return { summary: null, summary_status: 'pending' as const }

  const items = teacherLogSummaryCurrentItemsSchema.safeParse(rawItems)
  const names = teacherLogSummaryInitialsMapSchema.safeParse(cached.initials_map)
  if (!items.success || !names.success) throw failure()
  const fresh = cached.entry_count === actualEntryCount
    && (cached.entries_updated_at === null
      || Date.parse(cached.entries_updated_at) >= maxUpdatedAt)
  if (!fresh) return { summary: null, summary_status: 'pending' as const }

  const restored = restoreNames(items.data, names.data)
  return {
    summary_status: 'ready' as const,
    summary: { ...restored, generated_at: cached.generated_at },
  }
}
