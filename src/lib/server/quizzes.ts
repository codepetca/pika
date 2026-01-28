import { getServiceRoleClient } from '@/lib/supabase'

export type QuizAccessRecord = {
  id: string
  classroom_id: string
  status: string
  title: string
  show_results: boolean
  position: number
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
  | { ok: true; quiz: T }
  | { ok: false; status: number; error: string }

export async function assertTeacherOwnsQuiz(
  teacherId: string,
  quizId: string,
  opts?: { checkArchived?: boolean }
): Promise<AccessResult<QuizAccessRecord>> {
  const supabase = getServiceRoleClient()
  const { data: quiz, error } = await supabase
    .from('quizzes')
    .select(`
      *,
      classrooms!inner (
        id,
        teacher_id,
        archived_at
      )
    `)
    .eq('id', quizId)
    .single()

  if (error || !quiz) {
    return { ok: false, status: 404, error: 'Quiz not found' }
  }

  if (quiz.classrooms.teacher_id !== teacherId) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  if (opts?.checkArchived && quiz.classrooms.archived_at) {
    return { ok: false, status: 403, error: 'Classroom is archived' }
  }

  return { ok: true, quiz: quiz as QuizAccessRecord }
}

export async function assertStudentCanAccessQuiz(
  studentId: string,
  quizId: string
): Promise<AccessResult<QuizAccessRecord>> {
  const supabase = getServiceRoleClient()
  const { data: quiz, error } = await supabase
    .from('quizzes')
    .select(`
      *,
      classrooms!inner (
        id,
        teacher_id,
        archived_at
      )
    `)
    .eq('id', quizId)
    .single()

  if (error || !quiz) {
    return { ok: false, status: 404, error: 'Quiz not found' }
  }

  if (quiz.classrooms.archived_at) {
    return { ok: false, status: 403, error: 'Classroom is archived' }
  }

  const { data: enrollment, error: enrollError } = await supabase
    .from('classroom_enrollments')
    .select('id')
    .eq('classroom_id', quiz.classroom_id)
    .eq('student_id', studentId)
    .single()

  if (enrollError || !enrollment) {
    return { ok: false, status: 403, error: 'Not enrolled in this classroom' }
  }

  return { ok: true, quiz: quiz as QuizAccessRecord }
}
