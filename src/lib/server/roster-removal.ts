export const MAX_ROSTER_REMOVALS_PER_REQUEST = 100

export interface RosterRemovalResult {
  requested_count: number
  deleted_roster_entries: number
  deleted_entries: number
  deleted_assignment_docs: number
  deleted_enrollments: number
}

export function normalizeRosterIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    )
  )
}

export function getKnownRosterRemovalRpcError(error: {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
} | null | undefined): { status: number; message: string } | null {
  if (!error) return null

  const message = (error.message || '').toLowerCase()

  if (error.message === 'One or more roster entries not found in classroom') {
    return { status: 400, message: error.message }
  }

  if (
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    message.includes('remove_classroom_roster_entries_atomic')
  ) {
    return {
      status: 400,
      message: 'Roster removal requires migration 071 to be applied',
    }
  }

  return null
}

export async function removeClassroomRosterEntriesAtomic({
  supabase,
  classroomId,
  rosterIds,
}: {
  supabase: any
  classroomId: string
  rosterIds: string[]
}) {
  return supabase.rpc('remove_classroom_roster_entries_atomic', {
    p_classroom_id: classroomId,
    p_roster_ids: rosterIds,
  })
}
