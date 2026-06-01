import {
  buildAiSanitizationContext,
  type AiSanitizationContext,
  type AiSanitizationStudent,
} from '@/lib/ai-sanitization'
import { loadChunkedRows } from '@/lib/server/query-chunks'
import { getServiceRoleClient } from '@/lib/supabase'

type ServiceRoleSupabase = ReturnType<typeof getServiceRoleClient>

type EnrollmentRow = { student_id: string | null }
type ProfileRow = {
  user_id: string
  first_name: string | null
  last_name: string | null
}
type RosterNameRow = {
  first_name: string | null
  last_name: string | null
}

export class AiSanitizationContextLoadError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'AiSanitizationContextLoadError'
    this.cause = cause
  }
}

export async function loadClassroomAiSanitizationContext(
  supabase: ServiceRoleSupabase,
  classroomId: string,
): Promise<AiSanitizationContext> {
  if (!classroomId) {
    throw new AiSanitizationContextLoadError('Cannot load AI sanitization context without a classroom id')
  }

  let enrollmentRows: unknown
  let rosterRows: unknown
  let enrollmentError: unknown
  let rosterError: unknown

  try {
    const [enrollmentResult, rosterResult] = await Promise.all([
      supabase
        .from('classroom_enrollments')
        .select('student_id')
        .eq('classroom_id', classroomId),
      supabase
        .from('classroom_roster')
        .select('first_name, last_name')
        .eq('classroom_id', classroomId),
    ])

    enrollmentRows = enrollmentResult.data
    enrollmentError = enrollmentResult.error
    rosterRows = rosterResult.data
    rosterError = rosterResult.error
  } catch (error) {
    throw new AiSanitizationContextLoadError('Failed to load classroom names for AI sanitization', error)
  }

  if (enrollmentError) {
    throw new AiSanitizationContextLoadError('Failed to load classroom enrollments for AI sanitization', enrollmentError)
  }

  if (rosterError) {
    throw new AiSanitizationContextLoadError('Failed to load classroom roster names for AI sanitization', rosterError)
  }

  const studentIds = Array.from(
    new Set(
      ((enrollmentRows as EnrollmentRow[] | null) ?? [])
        .map((row) => row.student_id)
        .filter((studentId): studentId is string => typeof studentId === 'string' && studentId.length > 0),
    ),
  )

  const profilesResult = studentIds.length > 0
    ? await loadChunkedRows<ProfileRow>({
        supabase,
        table: 'student_profiles',
        select: 'user_id, first_name, last_name',
        filters: [{ column: 'user_id', values: studentIds }],
      })
    : { rows: [] as ProfileRow[], error: null }

  if (profilesResult.error) {
    throw new AiSanitizationContextLoadError('Failed to load student profile names for AI sanitization', profilesResult.error)
  }

  const studentsByName = new Map<string, AiSanitizationStudent>()
  const addStudent = (firstName?: string | null, lastName?: string | null) => {
    const student = {
      firstName: firstName || '',
      lastName: lastName || '',
    }
    const key = `${student.firstName} ${student.lastName}`.trim().toLowerCase()
    if (!key) return
    if (!studentsByName.has(key)) studentsByName.set(key, student)
  }

  for (const profile of profilesResult.rows) {
    addStudent(profile.first_name, profile.last_name)
  }

  for (const row of ((rosterRows as RosterNameRow[] | null) ?? [])) {
    addStudent(row.first_name, row.last_name)
  }

  return buildAiSanitizationContext([...studentsByName.values()])
}
