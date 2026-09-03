import { fetchCachedJSON, invalidateCachedJSON } from '@/lib/request-cache'
import { getValidEmailList } from '@/lib/gradebook-display'

export interface GradebookEmail2Row {
  student_id: string | null
  counselor_email: string | null
}

export async function loadGradebookEmail2(classroomId: string): Promise<GradebookEmail2Row[]> {
  const key = `teacher-roster:${classroomId}`
  invalidateCachedJSON(key)
  const data = await fetchCachedJSON<{ roster: GradebookEmail2Row[] }>(
    key, `/api/teacher/classrooms/${encodeURIComponent(classroomId)}/roster`,
    { ttlMs: 0, errorMessage: 'Could not load Email 2 addresses' },
  )
  if (!Array.isArray(data.roster)) throw new Error('Could not load Email 2 addresses')
  return data.roster
}

export function getGradebookEmail2Addresses(rows: GradebookEmail2Row[], selectedIds: ReadonlySet<string>): string[] {
  // Do not guess a binding by name/email when the roster has no stable student ID.
  const emails = getValidEmailList(rows.flatMap((row) => (
    row.student_id && selectedIds.has(row.student_id) && row.counselor_email ? [row.counselor_email] : []
  )))
  const seen = new Set<string>()
  return emails.filter((email) => {
    const key = email.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
