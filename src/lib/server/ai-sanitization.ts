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

export async function loadClassroomAiSanitizationContext(
  supabase: ServiceRoleSupabase,
  classroomId: string,
): Promise<AiSanitizationContext | null> {
  try {
    const [{ data: enrollmentRows, error: enrollmentError }, { data: rosterRows, error: rosterError }] =
      await Promise.all([
        supabase
          .from('classroom_enrollments')
          .select('student_id')
          .eq('classroom_id', classroomId),
        supabase
          .from('classroom_roster')
          .select('first_name, last_name')
          .eq('classroom_id', classroomId),
      ])

    if (enrollmentError || rosterError) {
      return null
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
      return null
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

    const students = [...studentsByName.values()]
    return students.length > 0 ? buildAiSanitizationContext(students) : null
  } catch {
    return null
  }
}
