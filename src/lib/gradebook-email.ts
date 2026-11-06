import { fetchCachedJSON, invalidateCachedJSON } from '@/lib/request-cache'
import { getValidEmailList } from '@/lib/gradebook-display'

export interface GradebookEmail2Row {
  student_id: string | null
  counselor_email: string | null
}

export interface GuardianRecipient {
  email: string
  status: 'Review address' | 'Missing guardian email' | 'Invalid guardian email' | 'Roster match unavailable' | 'Multiple roster entries'
}

/** Match only by the roster's student ID; never infer a guardian from a name. */
export function getGuardianRecipient(rows: GradebookEmail2Row[], studentId: string): GuardianRecipient {
  const matches = rows.filter((row) => row.student_id === studentId)
  if (matches.length === 0) return { email: '', status: 'Roster match unavailable' }
  if (matches.length !== 1) return { email: '', status: 'Multiple roster entries' }
  const email = matches[0].counselor_email?.trim() ?? ''
  if (!email) return { email: '', status: 'Missing guardian email' }
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) return { email: '', status: 'Invalid guardian email' }
  return { email, status: 'Review address' }
}

export async function loadGradebookEmail2(classroomId: string): Promise<GradebookEmail2Row[]> {
  const key = `teacher-roster:${classroomId}`
  invalidateCachedJSON(key)
  const data = await fetchCachedJSON<{ roster: GradebookEmail2Row[] }>(
    key, `/api/teacher/classrooms/${encodeURIComponent(classroomId)}/roster`,
    { ttlMs: 0, errorMessage: 'Could not load guardian email addresses' },
  )
  if (!Array.isArray(data.roster)) throw new Error('Could not load guardian email addresses')
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
