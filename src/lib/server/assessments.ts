import { getServiceRoleClient } from '@/lib/supabase'
import { isVisibleAtNow } from '@/lib/scheduling'
import type { TestAssessmentStatus, TestAssessmentType } from '@/types'

export type AssessmentAccessRecord = {
  id: string
  classroom_id: string
  assessment_type?: TestAssessmentType | null
  status: TestAssessmentStatus
  opens_at: string | null
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

export type QuizAccessRecord = AssessmentAccessRecord

type AccessResult<T> =
  | { ok: true; assessment: T; quiz: T }
  | { ok: false; status: number; error: string }

type AssessmentVisibilityRecord = {
  status: TestAssessmentStatus
  opens_at: string | null
}

type QuizVisibilityRecord = AssessmentVisibilityRecord

function assessmentAccessSuccess<T>(assessment: T): AccessResult<T> {
  return {
    ok: true,
    assessment,
    quiz: assessment,
  }
}

export function isAssessmentVisibleToStudents(
  assessment: AssessmentVisibilityRecord,
  now: Date = new Date()
): boolean {
  if (assessment.status !== 'active') return false
  return isVisibleAtNow(assessment.opens_at, now)
}

export const isQuizVisibleToStudents = isAssessmentVisibleToStudents

export function hasAssessmentOpened(
  assessment: AssessmentVisibilityRecord,
  now: Date = new Date()
): boolean {
  return assessment.status === 'active' && isVisibleAtNow(assessment.opens_at, now)
}

export const hasQuizOpened = hasAssessmentOpened

export async function assertTeacherOwnsAssessment(
  teacherId: string,
  assessmentId: string,
  opts?: { checkArchived?: boolean }
): Promise<AccessResult<AssessmentAccessRecord>> {
  const supabase = getServiceRoleClient()
  const { data: assessment, error } = await supabase
    .from('quizzes')
    .select(`
      *,
      classrooms!inner (
        id,
        teacher_id,
        archived_at
      )
    `)
    .eq('id', assessmentId)
    .single()

  if (error || !assessment) {
    return { ok: false, status: 404, error: 'Quiz not found' }
  }

  if (assessment.classrooms.teacher_id !== teacherId) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  if (opts?.checkArchived && assessment.classrooms.archived_at) {
    return { ok: false, status: 403, error: 'Classroom is archived' }
  }

  return assessmentAccessSuccess(assessment as AssessmentAccessRecord)
}

export const assertTeacherOwnsQuiz = assertTeacherOwnsAssessment

export async function assertStudentCanAccessAssessment(
  studentId: string,
  assessmentId: string
): Promise<AccessResult<AssessmentAccessRecord>> {
  const supabase = getServiceRoleClient()
  const { data: assessment, error } = await supabase
    .from('quizzes')
    .select(`
      *,
      classrooms!inner (
        id,
        teacher_id,
        archived_at
      )
    `)
    .eq('id', assessmentId)
    .single()

  if (error || !assessment) {
    return { ok: false, status: 404, error: 'Quiz not found' }
  }

  if (assessment.classrooms.archived_at) {
    return { ok: false, status: 403, error: 'Classroom is archived' }
  }

  const { data: enrollment, error: enrollError } = await supabase
    .from('classroom_enrollments')
    .select('id')
    .eq('classroom_id', assessment.classroom_id)
    .eq('student_id', studentId)
    .single()

  if (enrollError || !enrollment) {
    return { ok: false, status: 403, error: 'Not enrolled in this classroom' }
  }

  return assessmentAccessSuccess(assessment as AssessmentAccessRecord)
}

export const assertStudentCanAccessQuiz = assertStudentCanAccessAssessment
