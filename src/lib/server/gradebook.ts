import { projectOwnerGradebook } from '@/lib/gradebook-projection'
import { isGradebookMaximumEditingEnabled, loadGradebookMaximumState, saveEffectiveGradebookMark } from '@/lib/server/gradebook-maximum'
import { logServerError } from '@/lib/server/diagnostics'
import { getServiceRoleClient } from '@/lib/supabase'
import { ApiError } from '@/lib/api-error'
import type {
  GradebookCategoriesPutCommand,
  GradebookPatchCommand,
} from '@/lib/validations/gradebook'
import type {
  GradebookScoreOverrideDeleteCommand,
  GradebookScoreOverridePutCommand,
} from '@/lib/validations/gradebook-score-overrides'
import {
  loadChunkedRows,
  loadPagedRows as loadServerPagedRows,
} from '@/lib/server/query-chunks'

const ASSIGNMENT_POINTS_DEFAULT = 30
const ASSESSMENT_WEIGHT_DEFAULT = 10
const GRADEBOOK_BULK_FILTER_CHUNK_SIZE = 50
const GRADEBOOK_BULK_PAGE_SIZE = 1000
type GradebookCategory = { id: string; name: string; percentage: number; default_assessment_weight: number; position: number; is_default: boolean }
type GradebookOverrideType = 'assignment' | 'test' | 'final'

async function loadPagedRows<T>(
  buildQuery: () => any,
): Promise<{ rows: T[]; error: any }> {
  return loadServerPagedRows<T>(buildQuery, GRADEBOOK_BULK_PAGE_SIZE)
}

async function loadSingleFilterRows<T>(
  supabase: any,
  table: string,
  selection: string,
  filterColumn: string,
  ids: string[],
): Promise<{ rows: T[]; error: any }> {
  return loadChunkedRows<T>({
    supabase,
    table,
    select: selection,
    filters: [{ column: filterColumn, values: ids }],
    chunkSize: GRADEBOOK_BULK_FILTER_CHUNK_SIZE,
    pageSize: GRADEBOOK_BULK_PAGE_SIZE,
  })
}

async function loadStudentScopedRows<T>(
  supabase: any,
  table: string,
  selection: string,
  assessmentColumn: string,
  assessmentIds: string[],
  studentIds: string[],
): Promise<{ rows: T[]; error: any }> {
  return loadChunkedRows<T>({
    supabase,
    table,
    select: selection,
    filters: [
      { column: assessmentColumn, values: assessmentIds },
      { column: 'student_id', values: studentIds },
    ],
    chunkSize: GRADEBOOK_BULK_FILTER_CHUNK_SIZE,
    pageSize: GRADEBOOK_BULK_PAGE_SIZE,
  })
}

function mentionsMissingField(
  error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined,
  field: string
): boolean {
  if (!error) return false
  const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  return combined.includes(field.toLowerCase()) && (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    combined.includes('column')
  )
}

function isMissingTableError(
  error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined
): boolean {
  if (!error) return false
  const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  return error.code === 'PGRST205' || error.code === '42P01' || combined.includes('could not find the table')
}

function normalizeAssessmentWeight(value: unknown): number {
  const weight = Number(value ?? ASSESSMENT_WEIGHT_DEFAULT)
  return Number.isFinite(weight) && weight >= 0 ? Math.round(weight) : ASSESSMENT_WEIGHT_DEFAULT
}
function comparePositionThenTitle(a: { position: number; title: string; id: string }, b: { position: number; title: string; id: string }): number { return a.position - b.position || a.title.localeCompare(b.title) || a.id.localeCompare(b.id) }
function assessmentTableName(type: GradebookOverrideType): 'assignments' | 'tests' { return type === 'assignment' ? 'assignments' : 'tests' }

async function assertTeacherOwnsClassroom(
  teacherId: string,
  classroomId: string,
  options?: { checkArchived?: boolean }
) {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
    .from('classrooms')
    .select('id, teacher_id, archived_at')
    .eq('id', classroomId)
    .single()

  if (error || !data) throw new ApiError(404, 'Classroom not found')
  if (data.teacher_id !== teacherId) throw new ApiError(403, 'Forbidden')
  if (options?.checkArchived && data.archived_at) {
    throw new ApiError(403, 'Classroom is archived')
  }
  return data
}

export async function loadTeacherGradebook(opts: {
  teacherId: string
  classroomId: string
  selectedStudentId: string | null
}) {
  const { teacherId, classroomId, selectedStudentId } = opts
  await assertTeacherOwnsClassroom(teacherId, classroomId)

  const supabase = getServiceRoleClient()

  const maximumState = await loadGradebookMaximumState(classroomId)
  const categoryResult = await supabase
    .from('gradebook_categories')
    .select('id, name, percentage, default_assessment_weight, position, is_default')
    .eq('classroom_id', classroomId)
    .order('position', { ascending: true })

  let categories: GradebookCategory[] = []
  let categorySchemaAvailable = true
  if (categoryResult.error && isMissingTableError(categoryResult.error)) {
    categorySchemaAvailable = false
  } else if (categoryResult.error) {
    logServerError('gradebook.categories', categoryResult.error)
    throw new ApiError(500, 'Failed to load gradebook categories')
  } else {
    categories = (categoryResult.data || []).map((category) => ({
      id: category.id,
      name: category.name,
      percentage: Number(category.percentage),
      default_assessment_weight: normalizeAssessmentWeight(category.default_assessment_weight),
      position: Number(category.position),
      is_default: Boolean(category.is_default),
    }))
  }

  const {
    rows: enrollments,
    error: enrollmentError,
  } = await loadPagedRows<Array<{ student_id: string; users: { email: string } }>[number]>(() =>
    supabase
      .from('classroom_enrollments')
      .select('student_id, users!inner(email)')
      .eq('classroom_id', classroomId)
  )

  if (enrollmentError) {
    logServerError('gradebook.enrollments', enrollmentError)
    throw new ApiError(500, 'Failed to load roster')
  }

  const studentIds = (enrollments || []).map((row) => row.student_id)
  const enrolledStudentIds = new Set(studentIds)
  if (selectedStudentId && !studentIds.includes(selectedStudentId)) {
    throw new ApiError(404, 'Student is not enrolled in this classroom')
  }

  const {
    rows: profiles,
    error: profilesError,
  } = await loadSingleFilterRows<{
    user_id: string
    student_number: string | null
    first_name: string | null
    last_name: string | null
  }>(
    supabase,
    'student_profiles',
    'user_id, student_number, first_name, last_name',
    'user_id',
    studentIds
  )

  if (profilesError) {
    logServerError('gradebook.profiles', profilesError)
    throw new ApiError(500, 'Failed to load student profiles for gradebook')
  }

  const { rows: items, error: itemsError } = await loadPagedRows<{
    id: string; title: string; points_possible: number; gradebook_weight: number
    gradebook_category_id: string | null; include_in_final: boolean
  }>(() => supabase.from('gradebook_items')
    .select('id, title, points_possible, gradebook_weight, gradebook_category_id, include_in_final')
    .eq('classroom_id', classroomId).order('created_at').order('id'))
  const itemsAvailable = !itemsError && categorySchemaAvailable
  if (itemsError && !isMissingTableError(itemsError)) {
    throw new ApiError(500, 'Failed to load Gradebook items')
  }
  if (items.length && !categorySchemaAvailable) throw new ApiError(500, 'Gradebook categories are unavailable')
  const { rows: itemScores, error: itemScoresError } = await loadStudentScopedRows<{
    item_id: string; student_id: string; earned: number; returned_at: string | null
  }>(supabase, 'gradebook_item_scores', 'item_id, student_id, earned, returned_at',
    'item_id', items.map((item) => item.id), studentIds)
  if (itemScoresError) throw new ApiError(500, 'Failed to load Gradebook item marks')


  let assignments: Array<{
    id: string
    title: string
    due_at: string
    position: number
    is_draft: boolean
    points_possible: number
    include_in_final: boolean
    gradebook_weight: number
    gradebook_category_id: string | null
  }> = []

  const {
    rows: assignmentsWithMeta,
    error: assignmentsWithMetaError,
  } = await loadPagedRows<any>(() =>
    supabase
      .from('assignments')
      .select('id, title, due_at, position, points_possible, include_in_final, is_draft, gradebook_weight, gradebook_category_id')
      .eq('classroom_id', classroomId)
      .order('position', { ascending: true })
  )

  if (!assignmentsWithMetaError) {
    assignments = (assignmentsWithMeta || []).map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      due_at: assignment.due_at || new Date(0).toISOString(),
      position: Number(assignment.position ?? 0),
      is_draft: assignment.is_draft,
      points_possible: Number(assignment.points_possible ?? ASSIGNMENT_POINTS_DEFAULT),
      include_in_final: assignment.include_in_final !== false,
      gradebook_weight: normalizeAssessmentWeight(assignment.gradebook_weight),
      gradebook_category_id: assignment.gradebook_category_id ?? null,
    }))
  } else {
    const assignmentSelection = mentionsMissingField(assignmentsWithMetaError, 'gradebook_category_id')
      ? 'id, title, due_at, position, points_possible, include_in_final, is_draft, gradebook_weight'
      : mentionsMissingField(assignmentsWithMetaError, 'gradebook_weight')
      ? 'id, title, due_at, position, points_possible, include_in_final, is_draft'
      : 'id, title, due_at, position, is_draft'

    // Backward-compatible fallback for databases that have not applied gradebook metadata columns yet.
    const {
      rows: assignmentsLegacy,
      error: assignmentsLegacyError,
    } = await loadPagedRows<any>(() =>
      supabase
        .from('assignments')
        .select(assignmentSelection)
        .eq('classroom_id', classroomId)
        .order('position', { ascending: true })
    )

    if (assignmentsLegacyError) {
      logServerError('gradebook.assignments', assignmentsLegacyError)
      throw new ApiError(500, 'Failed to load assignments for gradebook')
    }

    assignments = ((assignmentsLegacy || []) as Array<any>).map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      due_at: assignment.due_at || new Date(0).toISOString(),
      position: Number(assignment.position ?? 0),
      is_draft: assignment.is_draft,
      points_possible: Number(assignment.points_possible ?? ASSIGNMENT_POINTS_DEFAULT),
      include_in_final: assignment.include_in_final !== false,
      gradebook_weight: normalizeAssessmentWeight(assignment.gradebook_weight),
      gradebook_category_id: assignment.gradebook_category_id ?? null,
    }))
  }
  assignments.sort(comparePositionThenTitle)

  const assignmentIds = assignments.map((a) => a.id)
  let docs: Array<any> = []
  if (assignmentIds.length && studentIds.length) {
    const assignmentDocSelection = 'assignment_id, student_id, score_completion, score_thinking, score_workflow, is_submitted, submitted_at, returned_at, teacher_cleared_at, graded_at'
    const assignmentDocLegacySelection = 'assignment_id, student_id, score_completion, score_thinking, score_workflow, is_submitted, submitted_at, returned_at, graded_at'
    let docsResult = await loadStudentScopedRows<any>(
      supabase,
      'assignment_docs',
      assignmentDocSelection,
      'assignment_id',
      assignmentIds,
      studentIds
    )

    if (docsResult.error && mentionsMissingField(docsResult.error, 'teacher_cleared_at')) {
      docsResult = await loadStudentScopedRows<any>(
        supabase,
        'assignment_docs',
        assignmentDocLegacySelection,
        'assignment_id',
        assignmentIds,
        studentIds
      )
      if (!docsResult.error) {
        docs = docsResult.rows.map((doc) => ({ ...doc, teacher_cleared_at: null }))
      }
    } else if (!docsResult.error) {
      docs = docsResult.rows
    }

    if (docsResult.error) {
      logServerError('gradebook.documents', docsResult.error)
      throw new ApiError(500, 'Failed to load assignment docs for gradebook')
    }
  }

  let tests: Array<{
    id: string
    title: string
    position: number
    status: 'draft' | 'active' | 'closed' | null
    include_in_final: boolean
    gradebook_weight: number
    gradebook_category_id: string | null
  }> = []

  const {
    rows: testsWithMeta,
    error: testsWithMetaError,
  } = await loadPagedRows<any>(() =>
    supabase
      .from('tests')
      .select('id, title, status, position, include_in_final, gradebook_weight, gradebook_category_id')
      .eq('classroom_id', classroomId)
  )

  if (!testsWithMetaError) {
    tests = (testsWithMeta || []).map((test) => ({
      id: test.id,
      title: test.title,
      position: Number(test.position ?? 0),
      status: test.status ?? null,
      include_in_final: test.include_in_final !== false,
      gradebook_weight: normalizeAssessmentWeight(test.gradebook_weight),
      gradebook_category_id: test.gradebook_category_id ?? null,
    }))
  } else if (
    mentionsMissingField(testsWithMetaError, 'gradebook_category_id') ||
    mentionsMissingField(testsWithMetaError, 'include_in_final') ||
    mentionsMissingField(testsWithMetaError, 'gradebook_weight')
  ) {
    const testSelection = mentionsMissingField(testsWithMetaError, 'gradebook_category_id')
      ? 'id, title, status, position, include_in_final, gradebook_weight'
      : mentionsMissingField(testsWithMetaError, 'gradebook_weight')
      ? 'id, title, status, position, include_in_final'
      : 'id, title, status, position'

    const {
      rows: testsLegacy,
      error: testsLegacyError,
    } = await loadPagedRows<any>(() =>
      supabase
        .from('tests')
        .select(testSelection)
        .eq('classroom_id', classroomId)
    )

    if (!testsLegacyError) {
      tests = ((testsLegacy || []) as Array<any>).map((test) => ({
        id: test.id,
        title: test.title,
        position: Number(test.position ?? 0),
        status: test.status ?? null,
        include_in_final: test.include_in_final !== false,
        gradebook_weight: normalizeAssessmentWeight(test.gradebook_weight),
        gradebook_category_id: test.gradebook_category_id ?? null,
      }))
    } else if (!isMissingTableError(testsLegacyError)) {
      logServerError('gradebook.tests', testsLegacyError)
      throw new ApiError(500, 'Failed to load tests for gradebook')
    }
  } else if (!isMissingTableError(testsWithMetaError)) {
    logServerError('gradebook.tests', testsWithMetaError)
    throw new ApiError(500, 'Failed to load tests for gradebook')
  }
  tests.sort(comparePositionThenTitle)

  const testIds = tests.map((test) => test.id)
  let scoreOverridesAvailable = true
  const {
    rows: scoreOverrides,
    error: scoreOverridesError,
  } = await loadPagedRows<{
    student_id: string
    assessment_type: GradebookOverrideType
    assessment_id: string
    earned: number
  }>(() =>
    supabase
      .from('gradebook_score_overrides')
      .select('student_id, assessment_type, assessment_id, earned')
      .eq('classroom_id', classroomId)
  )

  if (scoreOverridesError && isMissingTableError(scoreOverridesError)) {
    scoreOverridesAvailable = false
  } else if (scoreOverridesError) {
    logServerError('gradebook.overrides', scoreOverridesError)
    throw new ApiError(500, 'Failed to load Gradebook overrides')
  }
  const {
    rows: testQuestions,
    error: testQuestionsError,
  } = await loadSingleFilterRows<any>(
    supabase,
    'test_questions',
    'id, test_id, points',
    'test_id',
    testIds
  )

  if (testQuestionsError && !isMissingTableError(testQuestionsError)) {
    logServerError('gradebook.questions', testQuestionsError)
    throw new ApiError(500, 'Failed to load test questions for gradebook')
  }

  const {
    rows: testResponses,
    error: testResponsesError,
  } = await loadStudentScopedRows<any>(
    supabase,
    'test_responses',
    'test_id, question_id, student_id, score',
    'test_id',
    testIds,
    studentIds
  )

  if (testResponsesError && !isMissingTableError(testResponsesError)) {
    logServerError('gradebook.responses', testResponsesError)
    throw new ApiError(500, 'Failed to load test responses for gradebook')
  }

  const {
    rows: testAttempts,
    error: testAttemptsError,
  } = await loadStudentScopedRows<any>(
    supabase,
    'test_attempts',
    'test_id, student_id, is_submitted, submitted_at, returned_at',
    'test_id',
    testIds,
    studentIds
  )

  if (testAttemptsError && !isMissingTableError(testAttemptsError)) {
    logServerError('gradebook.attempts', testAttemptsError)
    throw new ApiError(500, 'Failed to load test attempts for gradebook')
  }

  const maximumFields = (type: 'assignment' | 'test' | 'item', id: string) => ({ gradebook_maximum_override: maximumState.states.get(type + ':' + id)?.maximum ?? null, gradebook_score_scale: maximumState.states.get(type + ':' + id)?.score_scale ?? 1 })
  return projectOwnerGradebook({
    roster: enrollments.map(row => ({ student_id: row.student_id, email: row.users.email })), profiles,
    categories: categories.map(row => ({ ...row, classroom_id: classroomId })),
    assignments: assignments.map(row => ({ ...row, classroom_id: classroomId, ...maximumFields('assignment', row.id) })),
    assignment_docs: docs.map(row => ({ ...row, is_submitted: row.is_submitted ?? null, submitted_at: row.submitted_at ?? null, returned_at: row.returned_at ?? null, teacher_cleared_at: row.teacher_cleared_at ?? null, graded_at: row.graded_at ?? null })),
    tests: tests.map(row => ({ ...row, classroom_id: classroomId, ...maximumFields('test', row.id) })),
    test_questions: testQuestions, test_responses: testResponses, test_attempts: testAttempts,
    items: items.map(row => ({ ...row, classroom_id: classroomId, created_at: new Date(0).toISOString(), ...maximumFields('item', row.id) })),
    item_scores: itemScores.map(row => ({ ...row, classroom_id: classroomId, updated_at: new Date(0).toISOString() })),
    score_overrides: scoreOverrides.map(row => ({ ...row, classroom_id: classroomId })),
  }, { categories: categorySchemaAvailable, scoreOverrides: scoreOverridesAvailable, maximumOverrides: maximumState.available, items: itemsAvailable }, classroomId, selectedStudentId, isGradebookMaximumEditingEnabled())
}

export async function updateTeacherGradebook(opts: {
  teacherId: string
  command: GradebookPatchCommand
}) {
  const { teacherId, command } = opts
  await assertTeacherOwnsClassroom(teacherId, command.classroomId, { checkArchived: true })

  if (command.kind === 'legacy_category_settings') {
    throw new ApiError(410, 'Category gradebook weights are retired; update assessment weights instead')
  }

  const supabase = getServiceRoleClient()
  if (command.kind === 'assessment_details' && command.gradebookCategoryId) {
    const { data: category, error: categoryError } = await supabase
      .from('gradebook_categories')
      .select('id')
      .eq('id', command.gradebookCategoryId)
      .eq('classroom_id', command.classroomId)
      .maybeSingle()

    if (categoryError && isMissingTableError(categoryError)) {
      throw new ApiError(409, 'Gradebook categories are not available until the database migration is applied')
    }
    if (categoryError) {
      logServerError('gradebook.category_validation', categoryError)
      throw new ApiError(500, 'Failed to validate gradebook category')
    }
    if (!category) throw new ApiError(400, 'Gradebook category does not belong to this classroom')
  }

  const assessmentUpdate = command.kind === 'assessment_details'
    ? {
        gradebook_weight: command.gradebookWeight,
        gradebook_category_id: command.gradebookCategoryId,
      }
    : { gradebook_weight: command.gradebookWeight }
  const updateQuery = command.assessmentType === 'assignment'
    ? supabase.from('assignments').update(assessmentUpdate)
    : supabase.from('tests').update(assessmentUpdate)
  const { data, error } = await updateQuery
    .eq('id', command.assessmentId)
    .eq('classroom_id', command.classroomId)
    .select('id, gradebook_weight, gradebook_category_id')
    .maybeSingle()

  if (error && (
    mentionsMissingField(error, 'gradebook_weight')
    || mentionsMissingField(error, 'gradebook_category_id')
  )) {
    throw new ApiError(409, 'Assessment weights are not available until the database migration is applied')
  }

  if (error) {
    logServerError('gradebook.weight_save', error)
    throw new ApiError(500, 'Failed to save assessment weight')
  }

  if (!data) {
    throw new ApiError(404, 'Assessment not found')
  }
  return {
    assessment: {
      assessment_id: data.id,
      assessment_type: command.assessmentType,
      weight: normalizeAssessmentWeight(data.gradebook_weight),
      ...(command.kind === 'assessment_details'
        ? { category_id: data.gradebook_category_id ?? null }
        : {}),
    },
  }
}

async function assertGradebookOverrideTarget(input: {
  classroomId: string
  studentId: string
  assessmentType: GradebookOverrideType
  assessmentId: string
}) {
  const supabase = getServiceRoleClient()
  const { data: enrollment, error: enrollmentError } = await supabase
    .from('classroom_enrollments')
    .select('student_id')
    .eq('classroom_id', input.classroomId)
    .eq('student_id', input.studentId)
    .maybeSingle()

  if (enrollmentError) {
    logServerError('gradebook.override_enrollment', enrollmentError)
    throw new ApiError(500, 'Failed to validate student')
  }
  if (!enrollment) throw new ApiError(404, 'Student is not enrolled in this classroom')
  if (input.assessmentType === 'final') {
    if (input.assessmentId !== input.classroomId) throw new ApiError(400, 'Invalid final override target')
    return
  }

  const { data: assessment, error: assessmentError } = await supabase
    .from(assessmentTableName(input.assessmentType))
    .select('id')
    .eq('id', input.assessmentId)
    .eq('classroom_id', input.classroomId)
    .maybeSingle()
  if (assessmentError) {
    logServerError('gradebook.override_assessment', assessmentError)
    throw new ApiError(500, 'Failed to validate assessment')
  }
  if (!assessment) throw new ApiError(404, 'Assessment not found')
}

export async function saveTeacherGradebookScoreOverride(opts: {
  teacherId: string
  command: GradebookScoreOverridePutCommand
}) {
  const { teacherId, command } = opts
  await assertTeacherOwnsClassroom(teacherId, command.classroom_id, { checkArchived: true })
  await assertGradebookOverrideTarget({
    classroomId: command.classroom_id,
    studentId: command.student_id,
    assessmentType: command.assessment_type,
    assessmentId: command.assessment_id,
  })

  const supabase = getServiceRoleClient()
  if (command.assessment_type !== 'final' && (await loadGradebookMaximumState(command.classroom_id)).available) {
    return await saveEffectiveGradebookMark(teacherId, command.classroom_id, command.assessment_type, command.assessment_id, command.student_id, command.earned)
  }
  const { error } = await supabase.from('gradebook_score_overrides').upsert({
    classroom_id: command.classroom_id,
    student_id: command.student_id,
    assessment_type: command.assessment_type,
    assessment_id: command.assessment_id,
    earned: command.earned,
    created_by: teacherId,
  }, { onConflict: 'classroom_id,student_id,assessment_type,assessment_id' })

  if (error && isMissingTableError(error)) {
    throw new ApiError(409, 'Gradebook overrides are not available until the database migration is applied')
  }
  if (error) {
    logServerError('gradebook.override_save', error)
    throw new ApiError(500, 'Failed to save override')
  }
  return { saved: true }
}

export async function deleteTeacherGradebookScoreOverride(opts: {
  teacherId: string
  command: GradebookScoreOverrideDeleteCommand
}) {
  const { teacherId, command } = opts
  await assertTeacherOwnsClassroom(teacherId, command.classroom_id, { checkArchived: true })
  if (command.scope === 'one') {
    await assertGradebookOverrideTarget({
      classroomId: command.classroom_id,
      studentId: command.student_id,
      assessmentType: command.assessment_type,
      assessmentId: command.assessment_id,
    })
  }

  const supabase = getServiceRoleClient()
  let query = supabase
    .from('gradebook_score_overrides')
    .delete()
    .eq('classroom_id', command.classroom_id)
  if (command.scope === 'one') {
    query = query
      .eq('student_id', command.student_id)
      .eq('assessment_type', command.assessment_type)
      .eq('assessment_id', command.assessment_id)
  }
  const { error } = await query

  if (error && isMissingTableError(error)) {
    throw new ApiError(409, 'Gradebook overrides are not available until the database migration is applied')
  }
  if (error) {
    logServerError('gradebook.override_undo', error)
    throw new ApiError(500, 'Failed to undo overrides')
  }
  return { deleted: true }
}

export async function replaceTeacherGradebookCategories(opts: {
  teacherId: string
  command: GradebookCategoriesPutCommand
}) {
  const { teacherId, command } = opts
  await assertTeacherOwnsClassroom(teacherId, command.classroomId, { checkArchived: true })

  const supabase = getServiceRoleClient()
  const payload = command.categories.map((category) => ({
    id: category.id,
    name: category.name,
    percentage: category.percentage,
    default_assessment_weight: category.defaultAssessmentWeight,
    position: category.position,
    is_default: category.isDefault,
  }))
  const { data, error } = await supabase.rpc('replace_gradebook_categories', {
    p_classroom_id: command.classroomId,
    p_categories: payload,
  })

  if (error && (isMissingTableError(error) || error.code === 'PGRST202')) {
    throw new ApiError(409, 'Gradebook categories are not available until the database migration is applied')
  }
  if (error) {
    logServerError('gradebook.categories_save', error)
    throw new ApiError(500, 'Failed to save gradebook categories')
  }

  return {
    categories: (data || []).map((category) => ({
      id: category.id,
      name: category.name,
      percentage: Number(category.percentage),
      default_assessment_weight: normalizeAssessmentWeight(category.default_assessment_weight),
      position: Number(category.position),
      is_default: Boolean(category.is_default),
    })),
  }
}
