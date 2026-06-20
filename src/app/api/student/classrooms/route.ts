import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { hydrateClassroomRecords } from '@/lib/server/classrooms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const STUDENT_CLASSROOM_SELECT_WITH_THEME = `
  id,
  created_at,
  classrooms!inner(
    id,
    title,
    class_code,
    theme_color,
    term_label,
    updated_at
  )
`

const STUDENT_CLASSROOM_SELECT_LEGACY = `
  id,
  created_at,
  classrooms!inner(
    id,
    title,
    class_code,
    term_label,
    updated_at
  )
`

function isMissingThemeColorError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const message = 'message' in error ? String((error as { message?: unknown }).message ?? '') : ''
  return message.includes('theme_color')
}

type StudentClassroomEnrollmentRow = {
  id: string
  created_at: string
  classrooms: Record<string, any>
}

async function fetchStudentClassroomEnrollments(
  supabase: ReturnType<typeof getServiceRoleClient>,
  studentId: string,
  selectClause: string
) {
  return supabase
    .from('classroom_enrollments')
    .select(selectClause)
    .eq('student_id', studentId)
    .is('classrooms.archived_at', null)
    .order('created_at', { ascending: false })
}

// GET /api/student/classrooms - List student's enrolled classrooms
export const GET = withErrorHandler('GetStudentClassrooms', async (request, context) => {
  const user = await requireRole('student')
  const supabase = getServiceRoleClient()

  let { data: enrollments, error } = await fetchStudentClassroomEnrollments(
    supabase,
    user.id,
    STUDENT_CLASSROOM_SELECT_WITH_THEME
  )

  if (error && isMissingThemeColorError(error)) {
    const legacyResult = await fetchStudentClassroomEnrollments(
      supabase,
      user.id,
      STUDENT_CLASSROOM_SELECT_LEGACY
    )
    enrollments = legacyResult.data
    error = legacyResult.error
  }

  if (error) {
    console.error('Error fetching classrooms:', error)
    return NextResponse.json(
      { error: 'Failed to fetch classrooms' },
      { status: 500 }
    )
  }

  const rows = (enrollments ?? []) as unknown as StudentClassroomEnrollmentRow[]
  const hydratedClassrooms = hydrateClassroomRecords(rows.map(e => e.classrooms))
  const classrooms = rows.map((e, index) => {
    const classroom = hydratedClassrooms[index]
    return {
      id: classroom.id,
      title: classroom.title,
      class_code: classroom.class_code,
      theme_color: classroom.theme_color,
      term_label: classroom.term_label,
      updated_at: classroom.updated_at,
      enrollmentId: e.id,
      enrolledAt: e.created_at,
    }
  })

  return NextResponse.json({ classrooms })
})
