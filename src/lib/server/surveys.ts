import { getServiceRoleClient } from '@/lib/supabase'
import type { SurveyStatus } from '@/types'

export type SurveyAccessRecord = {
  id: string
  classroom_id: string
  title: string
  status: SurveyStatus
  opens_at: string | null
  show_results: boolean
  dynamic_responses: boolean
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
  | { ok: true; survey: T }
  | { ok: false; status: number; error: string }

export function isMissingSurveysTableError(error: any): boolean {
  const message = String(error?.message || '')
  return error?.code === 'PGRST205' || message.includes('surveys')
}

export async function assertTeacherOwnsSurvey(
  teacherId: string,
  surveyId: string,
  opts?: { checkArchived?: boolean }
): Promise<AccessResult<SurveyAccessRecord>> {
  const supabase = getServiceRoleClient()
  const { data: survey, error } = await supabase
    .from('surveys')
    .select(`
      *,
      classrooms!inner (
        id,
        teacher_id,
        archived_at
      )
    `)
    .eq('id', surveyId)
    .single()

  if (error || !survey) {
    return { ok: false, status: 404, error: 'Survey not found' }
  }

  if (survey.classrooms.teacher_id !== teacherId) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  if (opts?.checkArchived && survey.classrooms.archived_at) {
    return { ok: false, status: 403, error: 'Classroom is archived' }
  }

  return { ok: true, survey: survey as SurveyAccessRecord }
}

export async function assertStudentCanAccessSurvey(
  studentId: string,
  surveyId: string
): Promise<AccessResult<SurveyAccessRecord>> {
  const supabase = getServiceRoleClient()
  const { data: survey, error } = await supabase
    .from('surveys')
    .select(`
      *,
      classrooms!inner (
        id,
        teacher_id,
        archived_at
      )
    `)
    .eq('id', surveyId)
    .single()

  if (error || !survey) {
    return { ok: false, status: 404, error: 'Survey not found' }
  }

  if (survey.classrooms.archived_at) {
    return { ok: false, status: 403, error: 'Classroom is archived' }
  }

  const { data: enrollment, error: enrollError } = await supabase
    .from('classroom_enrollments')
    .select('id')
    .eq('classroom_id', survey.classroom_id)
    .eq('student_id', studentId)
    .single()

  if (enrollError || !enrollment) {
    return { ok: false, status: 403, error: 'Not enrolled in this classroom' }
  }

  return { ok: true, survey: survey as SurveyAccessRecord }
}
