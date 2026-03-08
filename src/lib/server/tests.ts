import { getServiceRoleClient } from '@/lib/supabase'
import type { QuizStatus } from '@/types'

export type TestAccessRecord = {
  id: string
  classroom_id: string
  status: QuizStatus
  title: string
  show_results: boolean
  documents?: unknown
  position: number
  points_possible: number
  include_in_final: boolean
  created_by: string
  created_at: string
  updated_at: string
  classrooms: {
    id: string
    teacher_id: string
    archived_at: string | null
  }
}

type AccessResult<T> =
  | { ok: true; test: T }
  | { ok: false; status: number; error: string }

export function isMissingTestAttemptReturnColumnsError(error: {
  code?: string
  message?: string
  details?: string
  hint?: string
} | null | undefined): boolean {
  if (!error) return false
  const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  if (!combined.includes('returned_at') && !combined.includes('returned_by')) return false
  return error.code === '42703' || error.code === 'PGRST204' || combined.includes('column')
}

export function isMissingTestResponseAiColumnsError(error: {
  code?: string
  message?: string
  details?: string
  hint?: string
} | null | undefined): boolean {
  if (!error) return false
  const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  const mentionsAiColumn =
    combined.includes('ai_grading_basis') ||
    combined.includes('ai_reference_answers') ||
    combined.includes('ai_model')
  if (!mentionsAiColumn) return false
  return error.code === '42703' || error.code === 'PGRST204' || combined.includes('column')
}

export async function assertTeacherOwnsTest(
  teacherId: string,
  testId: string,
  opts?: { checkArchived?: boolean }
): Promise<AccessResult<TestAccessRecord>> {
  const supabase = getServiceRoleClient()
  const { data: test, error } = await supabase
    .from('tests')
    .select(`
      *,
      classrooms!inner (
        id,
        teacher_id,
        archived_at
      )
    `)
    .eq('id', testId)
    .single()

  if (error || !test) {
    return { ok: false, status: 404, error: 'Test not found' }
  }

  if (test.classrooms.teacher_id !== teacherId) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  if (opts?.checkArchived && test.classrooms.archived_at) {
    return { ok: false, status: 403, error: 'Classroom is archived' }
  }

  return { ok: true, test: test as TestAccessRecord }
}

export async function assertStudentCanAccessTest(
  studentId: string,
  testId: string
): Promise<AccessResult<TestAccessRecord>> {
  const supabase = getServiceRoleClient()
  const { data: test, error } = await supabase
    .from('tests')
    .select(`
      *,
      classrooms!inner (
        id,
        teacher_id,
        archived_at
      )
    `)
    .eq('id', testId)
    .single()

  if (error || !test) {
    return { ok: false, status: 404, error: 'Test not found' }
  }

  if (test.classrooms.archived_at) {
    return { ok: false, status: 403, error: 'Classroom is archived' }
  }

  const { data: enrollment, error: enrollError } = await supabase
    .from('classroom_enrollments')
    .select('id')
    .eq('classroom_id', test.classroom_id)
    .eq('student_id', studentId)
    .single()

  if (enrollError || !enrollment) {
    return { ok: false, status: 403, error: 'Not enrolled in this classroom' }
  }

  return { ok: true, test: test as TestAccessRecord }
}
