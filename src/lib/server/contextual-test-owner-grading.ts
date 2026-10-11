import { NextResponse } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { createContextualTestOwnerWorkflow } from '@/lib/server/contextual-test-owner-workflow'
import { assertManualAiProvenance, toRpcGrade } from '@/lib/server/test-grades'
import { getEffectiveStudentTestAccess } from '@/lib/server/tests'
import { aggregateTestResults, summarizeTestFocusEvents } from '@/lib/tests'
import { normalizeTestResponses } from '@/lib/test-attempts'
import { saveTestResponseGradeSchema } from '@/lib/validations/test-grading'
import { ownerGradingParamsSchema, ownerStudentGradesSchema, ownerClearGradesSchema, ownerReturnInputSchema,
  ownerSaveResultSchema, ownerClearResultSchema, ownerReturnResultSchema, ownerResultsSourceSchema, type OwnerResultsSource } from '@/lib/validations/contextual-test-owner-grading'
import { readContextualTestOwnerBody, resolveContextualTestOwnerParams, TEST_OWNER_WORKFLOW_DEADLINE_MS,
  type contextualTestOwnerWitnessSchema } from '@/lib/validations/contextual-test-owner-workflow'
import { z } from 'zod'

const unavailable = () => new ApiError(503, 'Unable to verify test operation')
type Test = z.infer<typeof contextualTestOwnerWitnessSchema>['test']
type Operation = 'results' | 'response-save' | 'student-save' | 'clear-open-grades' | 'return'
function sameIds(left: string[], right: string[]) { return left.length === right.length && new Set(left).size === left.length && left.every(id => right.includes(id)) }

export function validateOwnerGradeSaveResult(raw: unknown, studentId: string | null, grades: ReturnType<typeof toRpcGrade>[]) {
  const parsed = ownerSaveResultSchema.safeParse(raw)
  if (!parsed.success) throw unavailable()
  const result = parsed.data
  const cleared = grades.filter(grade => grade.clear_grade)
  if (result.student_id !== studentId || result.saved_count !== grades.length || result.responses.length !== grades.length
    || result.cleared_count !== cleared.length
    || !sameIds(result.clear_context.map(row => row.response_id), cleared.map(grade => grade.response_id!))
    || !sameIds(result.responses.map(row => row.id), grades.map(grade => grade.response_id!))) throw unavailable()
  for (const row of result.responses) {
    const grade = grades.find(grade => grade.response_id === row.id)!
    const context = result.clear_context.find(context => context.response_id === row.id)
    if (context && grade.question_id !== null && context.question_id !== grade.question_id) throw unavailable()
    // The SQL witness is captured from the current locked question/response,
    // never inferred from the incoming score or an unfenced follow-up query.
    const expectedScore = grade.clear_grade && context?.question_type === 'multiple_choice' ? 0 : grade.score
    if (row.revision < grade.expected_response_revision || row.revision > grade.expected_response_revision + 1
      || row.score !== expectedScore || row.feedback !== grade.feedback) throw unavailable()
  }
  return result
}

/** One admission decision. Once admitted, every failure escapes; no legacy retry. */
export async function handleContextualTestOwnerGradingRequest(operation: Operation, request: Request, params: Promise<unknown>): Promise<NextResponse | null> {
  if (!isClassroomExperienceAdmissionConfigured()) return null
  const actor = await requireAuth()
  if (resolveClassroomExperienceAdmission(actor).status !== 'admitted') return null
  const deadline = Date.now() + TEST_OWNER_WORKFLOW_DEADLINE_MS
  const identity = ownerGradingParamsSchema.parse(await resolveContextualTestOwnerParams(request, params, deadline))
  const body = operation === 'results' ? undefined : await readContextualTestOwnerBody(request, deadline)
  const flow = createContextualTestOwnerWorkflow({ supabase: getServiceRoleClient(), actorId: actor.id, testId: identity.id, deadline, signal: request.signal })
  if (operation === 'results') {
    await flow.inspect()
    const witness = await flow.run('results')
    return NextResponse.json(projectOwnerTestResults(witness.test, witness.result, actor.id))
  }
  if (operation === 'response-save' || operation === 'student-save') {
    if (operation === 'response-save' && !identity.responseId || operation === 'student-save' && !identity.studentId) throw new ApiError(400, 'Invalid grade target')
    const studentId = operation === 'student-save' ? identity.studentId! : null
    const grades = operation === 'response-save' ? (() => {
      const grade = saveTestResponseGradeSchema.parse(body)
      assertManualAiProvenance({ teacherId: actor.id, testId: identity.id, responseId: identity.responseId!, grade })
      return [toRpcGrade(grade, { responseId: identity.responseId! })]
    })() : ownerStudentGradesSchema.parse(body).grades.map(grade => {
      assertManualAiProvenance({ teacherId: actor.id, testId: identity.id, responseId: grade.response_id, grade })
      return toRpcGrade(grade)
    })
    await flow.inspect()
    const result = validateOwnerGradeSaveResult((await flow.run('manual-save', { student_id: studentId, grades })).result, studentId, grades)
    return NextResponse.json(operation === 'response-save' ? { response: result.responses[0] } : { saved_count: result.saved_count, responses: result.responses })
  }
  if (operation === 'clear-open-grades') {
    const payload = ownerClearGradesSchema.parse(body)
    if (new Set(payload.responses.map(row => row.response_id)).size !== payload.responses.length) throw new ApiError(400, 'Duplicate response identity')
    await flow.inspect()
    const parsed = ownerClearResultSchema.safeParse((await flow.run(operation, payload)).result)
    if (!parsed.success || !sameIds(parsed.data.student_ids, payload.student_ids)
      || parsed.data.cleared_students + parsed.data.skipped_students !== payload.student_ids.length
      || parsed.data.cleared_responses > payload.responses.length || parsed.data.cleared_students > parsed.data.cleared_responses
      || (parsed.data.cleared_students === 0) !== (parsed.data.cleared_responses === 0)) throw unavailable()
    const { student_ids: _ids, ...counts } = parsed.data
    return NextResponse.json(counts)
  }
  const payload = ownerReturnInputSchema.parse(body)
  await flow.inspect()
  const parsed = ownerReturnResultSchema.safeParse((await flow.run('return', payload)).result)
  if (!parsed.success || !sameIds(parsed.data.student_ids, payload.student_ids)
    || parsed.data.returned_count + parsed.data.already_returned_count + parsed.data.skipped_count !== payload.student_ids.length) throw unavailable()
  const { student_ids: _ids, ...counts } = parsed.data
  return NextResponse.json(counts)
}

function validateSource(test: Test, raw: unknown, actorId: string): OwnerResultsSource {
  const parsed = ownerResultsSourceSchema.safeParse(raw)
  if (!parsed.success) throw unavailable()
  const source = parsed.data; const members = new Set(source.student_ids); const questions = new Set(source.questions.map(row => row.id))
  if (members.size !== source.student_ids.length || members.has(actorId) || questions.size !== source.questions.length
    || source.questions.some(row => row.test_id !== test.id)
    || source.responses.some(row => row.test_id !== test.id || !members.has(row.student_id) || !questions.has(row.question_id))
    || new Set(source.responses.map(row => row.id)).size !== source.responses.length
    || new Set(source.responses.map(row => `${row.student_id}:${row.question_id}`)).size !== source.responses.length
    || !sameIds(source.users.map(row => row.id), source.student_ids)
    || source.profiles.some(row => !members.has(row.user_id)) || new Set(source.profiles.map(row => row.user_id)).size !== source.profiles.length) throw unavailable()
  for (const rows of [source.attempts, source.availability]) {
    if (rows.some(row => !members.has(row.student_id)) || new Set(rows.map(row => row.student_id)).size !== rows.length) throw unavailable()
  }
  if (source.focus_events.some(row => !members.has(row.student_id))) throw unavailable()
  const run = source.active_ai_grading_run
  if (run && (run.test_id !== test.id || run.requested_count > members.size || run.eligible_student_count > run.requested_count
    || run.processed_count !== run.completed_count + run.failed_count || run.pending_count !== Math.max(0, run.queued_response_count - run.processed_count)
    || run.error_samples.some(sample => sample.student_id !== null && !members.has(sample.student_id)))) throw unavailable()
  if (run?.next_retry_at) run.next_retry_at = new Date(run.next_retry_at).toISOString()
  return source
}

/** Same public monitoring projection as the legacy results route, using only
 * the transaction's bounded, current-roster source. No follow-up table reads. */
export function projectOwnerTestResults(test: Test, raw: unknown, actorId: string) {
  const source = validateSource(test, raw, actorId)
  const questions = [...source.questions].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  const responses = [...source.responses].sort((a, b) => a.id.localeCompare(b.id))
  const questionById = new Map(questions.map(row => [row.id, row]))
  const attempts = new Map(source.attempts.map(row => [row.student_id, row]))
  const users = new Map(source.users.map(row => [row.id, row]))
  const profiles = new Map(source.profiles.map(row => [row.user_id, row]))
  const availability = new Map(source.availability.map(row => [row.student_id, row.state]))
  const totalPoints = questions.reduce((sum, row) => sum + row.points, 0)
  type Answer = { response_id: string | null; response_revision: number | null; question_type: 'multiple_choice' | 'open_response';
    selected_option: number | null; response_text: string | null; score: number | null; feedback: string | null; graded_at: string | null; is_draft: boolean }
  const students = source.student_ids.map(studentId => {
    const attempt = attempts.get(studentId); const studentResponses = responses.filter(row => row.student_id === studentId)
    const answers: Record<string, Answer> = {}
    let submittedAt: string | null = null; let earned = 0; let graded = 0; let ungraded = 0
    for (const row of studentResponses) {
      const question = questionById.get(row.question_id)!
      answers[row.question_id] = { response_id: row.id, response_revision: row.revision, question_type: question.question_type,
        selected_option: row.selected_option, response_text: row.response_text, score: row.score, feedback: row.feedback, graded_at: row.graded_at, is_draft: false }
      if (row.score !== null) earned += row.score
      if (!submittedAt || Date.parse(row.submitted_at) > Date.parse(submittedAt)) submittedAt = row.submitted_at
      if (question.question_type === 'open_response') { if (row.score !== null) graded++; else ungraded++ }
    }
    const submitted = !!attempt?.is_submitted || (studentResponses.length > 0 && !attempt)
    const closed = !!attempt?.closed_for_grading_at
    const status = attempt?.returned_at ? 'returned' : submitted ? 'submitted' : closed ? 'closed' : attempt ? 'in_progress' : 'not_started'
    if (!submitted && !closed && attempt) {
      for (const key of Object.keys(answers)) delete answers[key]
      const draft = normalizeTestResponses(attempt.responses)
      for (const question of questions) {
        const row = draft[question.id]; if (!row) continue
        answers[question.id] = { response_id: null, response_revision: null, question_type: row.question_type,
          selected_option: row.question_type === 'multiple_choice' ? row.selected_option : null,
          response_text: row.question_type === 'open_response' ? row.response_text : null,
          score: null, feedback: null, graded_at: null, is_draft: true }
      }
    }
    const profile = profiles.get(studentId); const firstName = profile?.first_name?.trim() || null; const lastName = profile?.last_name?.trim() || null
    const access = getEffectiveStudentTestAccess({ testStatus: test.status, accessState: availability.get(studentId) ?? null,
      hasSubmitted: submitted, returnedAt: attempt?.returned_at || null, isLockedForGrading: closed })
    const events = source.focus_events.filter(row => row.student_id === studentId)
    submittedAt = attempt?.submitted_at || submittedAt
    return { student_id: studentId, name: `${firstName || ''} ${lastName || ''}`.trim() || null, first_name: firstName, last_name: lastName,
      email: users.get(studentId)!.email, status, submitted_at: submittedAt, returned_at: attempt?.returned_at || null, returned_by: attempt?.returned_by || null,
      closed_for_grading_at: attempt?.closed_for_grading_at || null, closed_for_grading_by: attempt?.closed_for_grading_by || null,
      last_activity_at: attempt?.updated_at || submittedAt, points_earned: earned, points_possible: totalPoints,
      percent: status === 'not_started' || totalPoints <= 0 ? null : earned / totalPoints * 100,
      graded_open_responses: graded, ungraded_open_responses: ungraded, access_state: access.access_state, effective_access: access.effective_access,
      access_source: access.access_source, answers, focus_summary: events.length ? summarizeTestFocusEvents(events) : null }
  }).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email) || a.student_id.localeCompare(b.student_id))
  const responders = students.filter(row => row.status === 'submitted').map(row => ({ student_id: row.student_id, name: row.name, email: row.email, answers: row.answers, focus_summary: row.focus_summary }))
  const openIds = new Set(questions.filter(row => row.question_type === 'open_response').map(row => row.id))
  const openResponses = responses.filter(row => openIds.has(row.question_id))
  return { test: { id: test.id, title: test.title, assessment_type: 'test' as const, status: test.status, show_results: test.show_results },
    questions: questions.map(q => ({ id: q.id, question_type: q.question_type, question_text: q.question_text, options: q.options, correct_option: q.correct_option,
      points: q.points, response_max_chars: q.response_max_chars, response_monospace: q.response_monospace, position: q.position })),
    results: aggregateTestResults(questions.filter(q => q.question_type !== 'open_response'), responses.flatMap(row => typeof row.selected_option === 'number'
      ? [{ id: row.id, test_id: test.id, question_id: row.question_id, student_id: row.student_id, selected_option: row.selected_option, submitted_at: row.submitted_at }] : [])),
    students, responders, stats: { total_students: students.length, responded: responders.length, open_questions_count: openIds.size,
      graded_open_responses: openResponses.filter(row => row.score !== null).length, ungraded_open_responses: openResponses.filter(row => row.score === null).length,
      returned_count: students.filter(row => row.returned_at !== null).length }, active_ai_grading_run: source.active_ai_grading_run }
}
