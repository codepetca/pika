import { getServiceRoleClient } from '@/lib/supabase'
import type { QuizStatus, TestStudentAvailabilityState } from '@/types'

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

export type EffectiveStudentTestAccess = {
  access_state: TestStudentAvailabilityState | null
  effective_access: TestStudentAvailabilityState
  access_source: 'test' | 'student'
  can_start_or_continue: boolean
  can_view_submitted: boolean
}

export function getEffectiveStudentTestAccess(params: {
  testStatus: QuizStatus
  accessState?: TestStudentAvailabilityState | null
  hasSubmitted?: boolean
  returnedAt?: string | null
  isLockedForGrading?: boolean
}): EffectiveStudentTestAccess {
  const accessState = params.accessState ?? null
  const hasStudentOverride = accessState === 'open' || accessState === 'closed'
  const hasSubmitted = params.hasSubmitted === true || !!params.returnedAt
  const isLockedForGrading = params.isLockedForGrading === true

  if (params.testStatus === 'draft') {
    return {
      access_state: accessState,
      effective_access: 'closed',
      access_source: 'test',
      can_start_or_continue: false,
      can_view_submitted: false,
    }
  }

  const effectiveAccess: TestStudentAvailabilityState = hasStudentOverride
    ? accessState
    : params.testStatus === 'active'
      ? 'open'
      : 'closed'

  return {
    access_state: accessState,
    effective_access: effectiveAccess,
    access_source: hasStudentOverride ? 'student' : 'test',
    can_start_or_continue: effectiveAccess === 'open' && !hasSubmitted && !isLockedForGrading,
    can_view_submitted: hasSubmitted || isLockedForGrading,
  }
}

export function isMissingTestAttemptClosureColumnsError(error: {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
} | null | undefined): boolean {
  if (!error) return false
  const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  return (
    (error.code === 'PGRST204' || error.code === '42703') &&
    combined.includes('closed_for_grading')
  )
}

export function isMissingTestStudentAvailabilityError(error: {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
} | null | undefined): boolean {
  if (!error) return false
  const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    (combined.includes('test_student_availability') && combined.includes('schema cache'))
  )
}

export async function getTestStudentAvailabilityMap(
  supabase: any,
  testId: string,
  studentIds: string[]
): Promise<{
  stateByStudentId: Map<string, TestStudentAvailabilityState>
  missingTable: boolean
  error: any
}> {
  const uniqueStudentIds = Array.from(new Set(studentIds.filter(Boolean)))
  const stateByStudentId = new Map<string, TestStudentAvailabilityState>()
  if (uniqueStudentIds.length === 0) {
    return { stateByStudentId, missingTable: false, error: null }
  }

  let data: Array<{ student_id: string; state: unknown }> | null = null
  let error: any = null
  try {
    const result = await supabase
      .from('test_student_availability')
      .select('student_id, state')
      .eq('test_id', testId)
      .in('student_id', uniqueStudentIds)

    data = result.data
    error = result.error
  } catch (caughtError) {
    error = caughtError
  }

  if (error) {
    return {
      stateByStudentId,
      missingTable:
        isMissingTestStudentAvailabilityError(error) ||
        `${error?.message || error}`.includes('Unexpected table: test_student_availability'),
      error,
    }
  }

  for (const row of data || []) {
    if (row.state === 'open' || row.state === 'closed') {
      stateByStudentId.set(row.student_id, row.state)
    }
  }

  return { stateByStudentId, missingTable: false, error: null }
}

export async function getTestStudentAvailabilityState(
  supabase: any,
  testId: string,
  studentId: string
): Promise<{
  state: TestStudentAvailabilityState | null
  missingTable: boolean
  error: any
}> {
  const result = await getTestStudentAvailabilityMap(supabase, testId, [studentId])
  return {
    state: result.stateByStudentId.get(studentId) ?? null,
    missingTable: result.missingTable,
    error: result.error,
  }
}

export function isMissingTestAttemptReturnColumnsError(error: {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
} | null | undefined): boolean {
  if (!error) return false
  const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  if (!combined.includes('returned_at') && !combined.includes('returned_by')) return false
  return error.code === '42703' || error.code === 'PGRST204' || combined.includes('column')
}

export function isMissingTestResponseAiColumnsError(error: {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
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
