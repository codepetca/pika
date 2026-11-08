import { z } from 'zod'
import { ApiError } from '@/lib/api-error'

export const assignmentReleaseScheduleSchema = z.discriminatedUnion('state', [
  z.object({ id: z.uuid(), scheduled_for: z.iso.datetime({ offset: true }), state: z.literal('pending'), notice_code: z.null() }).strict(),
  z.object({ id: z.uuid(), scheduled_for: z.iso.datetime({ offset: true }), state: z.literal('suppressed'), notice_code: z.enum(['access_unavailable', 'classroom_unavailable', 'deadline_before_schedule']) }).strict(),
])

const stateSchema = z.object({
  assignment_id: z.string().min(1),
  updated_at: z.string(),
  release_schedule: assignmentReleaseScheduleSchema,
}).strict()

// Compare instants without losing the sub-millisecond precision of Postgres timestamps.
function timestampKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/i.exec(value)
  const milliseconds = Date.parse(value)
  if (!match || !Number.isFinite(milliseconds)) return null
  return `${Math.floor(milliseconds / 1000)}:${(match[1] ?? '').padEnd(6, '0')}`
}

type AssignmentSnapshot = { id?: unknown; updated_at?: unknown; is_draft?: unknown; released_at?: unknown }
type ReleaseSchedule = z.infer<typeof stateSchema>['release_schedule']
type ReleaseStateResponse = { data: unknown; error: { code?: string } | null }
type ReleaseStateClient = {
  rpc: (name: 'get_assignment_release_states_for_owner_v1', args: {
    p_actor_id: string; p_classroom_id: string; p_assignment_ids: string[]
  }) => PromiseLike<ReleaseStateResponse>
}
const unavailable = () => new ApiError(503, 'Unable to verify assignment release schedules')

/** Owner-only projection. Each batch is independently authorized by the service-only RPC. */
export async function projectAssignmentReleaseStates<T extends AssignmentSnapshot>(
  supabase: ReleaseStateClient, actorId: string, classroomId: string, assignments: T[],
): Promise<Array<T & { release_schedule?: ReleaseSchedule }>> {
  const drafts = assignments.filter(a => a.is_draft === true && a.released_at === null)
  if (!drafts.length) return assignments
  const snapshots = new Map<string, string>()
  for (const row of drafts) {
    const timestamp = timestampKey(row.updated_at)
    if (typeof row.id !== 'string' || !row.id || !timestamp || snapshots.has(row.id)) throw unavailable()
    snapshots.set(row.id, timestamp)
  }
  const schedules = new Map<string, ReleaseSchedule>()
  const ids = [...snapshots.keys()]
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100)
    let response: ReleaseStateResponse
    try {
      response = await supabase.rpc('get_assignment_release_states_for_owner_v1', {
        p_actor_id: actorId, p_classroom_id: classroomId, p_assignment_ids: batch,
      })
    } catch { throw unavailable() }
    if (offset === 0 && response?.error?.code === 'PGRST202') return assignments
    if (!response || response.error || !Array.isArray(response.data)) throw unavailable()
    const seen = new Set<string>()
    for (const raw of response.data) {
      const parsed = stateSchema.safeParse(raw)
      if (!parsed.success) throw unavailable()
      const row = parsed.data
      const updated = timestampKey(row.updated_at)
      if (!batch.includes(row.assignment_id) || seen.has(row.assignment_id) || !updated || !timestampKey(row.release_schedule.scheduled_for)) throw unavailable()
      seen.add(row.assignment_id)
      if (updated === snapshots.get(row.assignment_id)) schedules.set(row.assignment_id, row.release_schedule)
    }
  }
  return assignments.map(row => {
    const schedule = typeof row.id === 'string' ? schedules.get(row.id) : undefined
    return schedule ? { ...row, release_schedule: schedule } : row
  })
}
