import { loadChunkedRows } from '@/lib/server/query-chunks'

const CLASSROOM_ROSTER_PAGE_SIZE = 1000

export type ClassroomRosterStudent = {
  id: string
  email: string
  first_name: string
  last_name: string
}

type EnrollmentRow = {
  id: string
  student_id: string
  users: { id: string; email: string } | Array<{ id: string; email: string }> | null
}

type StudentProfileRow = {
  id: string
  user_id: string
  first_name: string | null
  last_name: string | null
}

export type ClassroomRosterResult = {
  students: ClassroomRosterStudent[]
  studentIds: string[]
  enrollmentsError: any
  profilesError: any
}

function normalizeJoinedUser(users: EnrollmentRow['users']): { id: string; email: string } | null {
  const user = Array.isArray(users) ? users[0] : users
  if (!user || typeof user.id !== 'string') return null
  return {
    id: user.id,
    email: typeof user.email === 'string' ? user.email : '',
  }
}

export async function loadClassroomRoster(
  supabase: any,
  classroomId: string,
): Promise<ClassroomRosterResult> {
  const enrollmentsResult = await loadChunkedRows<EnrollmentRow>({
    supabase,
    table: 'classroom_enrollments',
    select: `
      id,
      student_id,
      users!classroom_enrollments_student_id_fkey(
        id,
        email
      )
    `,
    filters: [{ column: 'classroom_id', values: [classroomId] }],
    pageSize: CLASSROOM_ROSTER_PAGE_SIZE,
    pageOrderColumn: 'id',
  })

  if (enrollmentsResult.error) {
    return {
      students: [],
      studentIds: [],
      enrollmentsError: enrollmentsResult.error,
      profilesError: null,
    }
  }

  const studentIds = Array.from(new Set(
    enrollmentsResult.rows
      .map((enrollment) => enrollment.student_id)
      .filter((studentId): studentId is string => typeof studentId === 'string' && studentId.length > 0)
  ))

  const profilesResult = studentIds.length > 0
    ? await loadChunkedRows<StudentProfileRow>({
      supabase,
      table: 'student_profiles',
      select: 'id, user_id, first_name, last_name',
      filters: [{ column: 'user_id', values: studentIds }],
      pageSize: CLASSROOM_ROSTER_PAGE_SIZE,
      pageOrderColumn: 'id',
    })
    : { rows: [] as StudentProfileRow[], error: null }

  if (profilesResult.error) {
    return {
      students: [],
      studentIds,
      enrollmentsError: null,
      profilesError: profilesResult.error,
    }
  }

  const profileMap = new Map(
    profilesResult.rows.map((profile) => [profile.user_id, profile])
  )

  const students = enrollmentsResult.rows
    .map((enrollment) => {
      const user = normalizeJoinedUser(enrollment.users)
      const studentId = user?.id || enrollment.student_id
      const profile = profileMap.get(studentId)
      return {
        id: studentId,
        email: user?.email || '',
        first_name: profile?.first_name || '',
        last_name: profile?.last_name || '',
      }
    })
    .sort((a, b) => a.email.localeCompare(b.email) || a.id.localeCompare(b.id))

  return {
    students,
    studentIds,
    enrollmentsError: null,
    profilesError: null,
  }
}
