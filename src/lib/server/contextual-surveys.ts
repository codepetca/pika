import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { getServiceRoleClient } from '@/lib/supabase'
import { getStudentSurveyStatus, normalizeSurveyQuestionInput, validateSurveyResponses } from '@/lib/surveys'
import { surveyPatchSchema, surveyQuestionSchema } from '@/lib/validations/surveys'
import {
  contextualSurveyClassroomIdentitySchema, contextualSurveyDeleteSchema, contextualSurveyDetailSchema,
  contextualSurveyIdentitySchema, contextualSurveyListSchema, contextualSurveyMemberResultsSchema,
  contextualSurveyMutationSchema, contextualSurveyOwnerResultsSchema, contextualSurveyQuestionMutationSchema,
  contextualSurveyRespondSchema,
} from '@/lib/validations/contextual-surveys'
import type { AuthenticatedUser, SurveyQuestion } from '@/types'
import type { Database } from '@/types/database'

type SurveyRpcName = 'get_surveys_for_owner_v1' | 'get_surveys_for_member_v1' | 'get_survey_for_owner_v1' | 'get_survey_for_member_v1'
  | 'get_survey_results_for_owner_v1' | 'get_survey_results_for_member_v1' | 'update_survey_for_owner_v1' | 'delete_survey_for_owner_v1'
  | 'create_survey_question_for_owner_v1' | 'update_survey_question_for_owner_v1' | 'delete_survey_question_for_owner_v1' | 'respond_to_survey_for_member_v1'
type SurveyRpcClient = {
  rpc<Name extends SurveyRpcName>(name: Name, args: Database['public']['Functions'][Name]['Args']): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
}
type SurveyRetryBudget = { readonly deadline: number; retriesRemaining: number }
type Context = { actorId: string; surveyId: string; supabase?: SurveyRpcClient; retryBudget?: SurveyRetryBudget }
type Permission = 'owner' | 'member'
const unavailable = () => new ApiError(503, 'Survey operation unavailable')

/** Share across a mutation's preflight and writer: one extra call total.
 * This bounds retry admission, never the runtime of an already dispatched RPC. */
export function createContextualSurveyRetryBudget(): SurveyRetryBudget {
  return { deadline: performance.now() + 100, retriesRemaining: 1 }
}

export async function authorizeSharedSurveyActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  return (await resolveClassroomExperienceAdmission(user)).status === 'admitted' ? { mode: 'shared', user } : { mode: 'existing' }
}

async function invoke<Name extends SurveyRpcName, T extends z.ZodType>(client: SurveyRpcClient | undefined, name: Name, args: Database['public']['Functions'][Name]['Args'], schema: T, retryBudget = createContextualSurveyRetryBudget()): Promise<z.infer<T>> {
  let result: { data: unknown; error: { code?: string; message?: string } | null }
  const rpcClient: SurveyRpcClient = client ?? getServiceRoleClient()
  try { result = await rpcClient.rpc(name, args) } catch { throw unavailable() }
  // SQL269 reserves this exact tuple for a positively returned transaction abort.
  // Lifecycle 55000, snapshot/fence conflicts and uncertain transport outcomes
  // must never enter this branch. Replay the full RPC with its original args.
  if (result.error?.code === 'PT409' && result.error.message === 'survey_operation_busy'
    && retryBudget.retriesRemaining > 0 && performance.now() + 20 < retryBudget.deadline) {
    retryBudget.retriesRemaining--
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    if (performance.now() < retryBudget.deadline) {
      try { result = await rpcClient.rpc(name, args) } catch { throw unavailable() }
    }
  }
  if (result.error) {
    const code = result.error.code
    if (code === 'PT400' || code === '22023' || code === '23505') throw new ApiError(400, 'Invalid Survey operation')
    if (code === 'PT403' || code === '42501') throw new ApiError(403, 'Forbidden')
    if (code === 'PT404' || code === 'P0002') throw new ApiError(404, 'Survey not found')
    if (code === 'PT409' || code === '40001' || code === '40P01' || code === '55P03' || code === '55000') throw new ApiError(409, 'Survey changed; please retry')
    throw unavailable()
  }
  // Limit successful JSON before schema traversal. No overflow is truncated.
  if (JSON.stringify(result.data)?.length > 8 * 1024 * 1024) throw unavailable()
  const decoded = schema.safeParse(result.data)
  if (!decoded.success) throw unavailable()
  return decoded.data
}

function identity(input: Context) {
  const parsed = contextualSurveyIdentitySchema.safeParse(input)
  if (!parsed.success) throw new ApiError(400, 'Invalid Survey identifiers')
  // PostgreSQL returns canonical lowercase UUIDs; accepted URL spellings may
  // differ in case. Compare the same validated identity we send to the RPC.
  return { p_actor_id: parsed.data.actorId.toLowerCase(), p_survey_id: parsed.data.surveyId.toLowerCase() }
}

function verifyClassroom(classroom: { id: string; teacher_id: string; archived_at: string | null }, actorId: string, permission: Permission) {
  if (permission === 'owner' ? classroom.teacher_id !== actorId : classroom.teacher_id === actorId || classroom.archived_at !== null) throw unavailable()
}

export async function readContextualSurveyList(input: { actorId: string; classroomId: string; permission: Permission; supabase?: SurveyRpcClient; retryBudget?: SurveyRetryBudget }) {
  const parsed = contextualSurveyClassroomIdentitySchema.safeParse(input)
  if (!parsed.success) throw new ApiError(400, 'Invalid Survey identifiers')
  const actorId = parsed.data.actorId.toLowerCase()
  const classroomId = parsed.data.classroomId.toLowerCase()
  const data = await invoke(input.supabase, input.permission === 'owner' ? 'get_surveys_for_owner_v1' : 'get_surveys_for_member_v1', {
    p_actor_id: actorId, p_classroom_id: classroomId,
  }, contextualSurveyListSchema, input.retryBudget)
  verifyClassroom(data.classroom, actorId, input.permission)
  if (data.classroom.id !== classroomId) throw unavailable()
  const seen = new Set<string>()
  const surveys = data.surveys.map(row => {
    if (row.classroom_id !== classroomId || seen.has(row.id)) throw unavailable()
    seen.add(row.id)
    if (input.permission === 'owner') {
      if (!row.stats || row.stats.responded > row.stats.total_students) throw unavailable()
      const { has_submitted: _hasSubmitted, ...survey } = row
      return survey
    }
    if (row.status === 'draft' || typeof row.has_submitted !== 'boolean') throw unavailable()
    const { has_submitted: responded, stats: _stats, ...survey } = row
    return { ...survey, student_status: getStudentSurveyStatus(row, responded) }
  })
  return { surveys }
}

export async function readContextualSurveyDetail(input: Context & { permission: Permission }) {
  const ids = identity(input)
  const data = await invoke(input.supabase, input.permission === 'owner' ? 'get_survey_for_owner_v1' : 'get_survey_for_member_v1', ids, contextualSurveyDetailSchema, input.retryBudget)
  verifyClassroom(data.classroom, ids.p_actor_id, input.permission)
  if (data.survey.id !== ids.p_survey_id || data.survey.classroom_id !== data.classroom.id) throw unavailable()
  const seen = new Set<string>()
  for (const question of data.questions) {
    if (question.survey_id !== ids.p_survey_id || seen.has(question.id)) throw unavailable()
    seen.add(question.id)
  }
  if (data.responses.some(row => row.survey_id !== ids.p_survey_id || row.student_id !== ids.p_actor_id || !seen.has(row.question_id))) throw unavailable()
  if (input.permission === 'owner') return { survey: { ...data.survey, classrooms: data.classroom }, questions: data.questions, classroom: data.classroom }
  if (data.survey.status === 'draft') throw unavailable()
  const hasResponded = data.responses.length > 0
  const studentStatus = getStudentSurveyStatus(data.survey, hasResponded)
  const studentResponses = Object.fromEntries(data.responses.map(row => [row.question_id, row.selected_option !== null
    ? { question_type: 'multiple_choice' as const, selected_option: row.selected_option }
    : { question_type: data.questions.find(q => q.id === row.question_id)?.question_type === 'link' ? 'link' as const : 'short_text' as const, response_text: row.response_text || '' }]))
  const { id, classroom_id, title, status, opens_at, show_results, dynamic_responses, position, created_at, updated_at } = data.survey
  return { survey: { id, classroom_id, title, status, opens_at, show_results, dynamic_responses, position, created_at, updated_at, student_status: studentStatus },
    questions: data.questions, student_status: studentStatus, has_submitted: hasResponded, student_responses: studentResponses }
}

/** Mutating transport preflight preserves authorization-before-body parsing.
 * The writer repeats all parent checks under its own transaction fence. */
export async function readContextualSurveyOwnerForMutation(input: Context) {
  const detail = await readContextualSurveyDetail({ ...input, permission: 'owner' })
  if (!('classroom' in detail) || !detail.classroom) throw unavailable()
  if (detail.classroom.archived_at !== null) throw new ApiError(403, 'Classroom is archived')
  return detail
}

export async function readContextualSurveyResults(input: Context & { permission: Permission }) {
  const ids = identity(input)
  const data = input.permission === 'owner'
    ? await invoke(input.supabase, 'get_survey_results_for_owner_v1', ids, contextualSurveyOwnerResultsSchema, input.retryBudget)
    : await invoke(input.supabase, 'get_survey_results_for_member_v1', ids, contextualSurveyMemberResultsSchema, input.retryBudget)
  verifyClassroom(data.classroom, ids.p_actor_id, input.permission)
  if (data.survey.id !== ids.p_survey_id) throw unavailable()
  const { classroom: _classroom, ...payload } = data
  return payload
}

export async function patchContextualSurvey(input: Context & { patch: z.infer<typeof surveyPatchSchema> }) {
  const ids = identity(input)
  const patch = { ...input.patch, ...(input.patch.opens_at ? { opens_at: new Date(input.patch.opens_at).toISOString() } : {}) }
  const data = await invoke(input.supabase, 'update_survey_for_owner_v1', { ...ids, p_patch: patch }, contextualSurveyMutationSchema, input.retryBudget)
  if (data.survey.id !== ids.p_survey_id) throw unavailable()
  return data
}

export async function deleteContextualSurvey(input: Context) {
  return invoke(input.supabase, 'delete_survey_for_owner_v1', identity(input), contextualSurveyDeleteSchema, input.retryBudget)
}

export async function createContextualSurveyQuestion(input: Context & { question: z.infer<typeof surveyQuestionSchema> }) {
  const ids = identity(input)
  const normalized = normalizeSurveyQuestionInput(input.question)
  if (!normalized.valid) throw new ApiError(400, normalized.error)
  const position = input.question.position === undefined ? undefined : Math.max(0, Math.floor(input.question.position))
  const data = await invoke(input.supabase, 'create_survey_question_for_owner_v1', { ...ids, p_question: { ...normalized.question, ...(position === undefined ? {} : { position }) } }, contextualSurveyQuestionMutationSchema, input.retryBudget)
  if (data.question.survey_id !== ids.p_survey_id) throw unavailable()
  return data
}

export async function patchContextualSurveyQuestion(input: Context & { questionId: string; question: z.infer<typeof surveyQuestionSchema>; existing: SurveyQuestion }) {
  const ids = identity(input)
  const questionId = z.string().uuid().parse(input.questionId).toLowerCase()
  if (input.existing.id !== questionId || input.existing.survey_id !== ids.p_survey_id) throw new ApiError(404, 'Question not found')
  const normalized = normalizeSurveyQuestionInput({ ...input.existing, ...input.question })
  if (!normalized.valid) throw new ApiError(400, normalized.error)
  const position = input.question.position === undefined ? input.existing.position : Math.max(0, Math.floor(input.question.position))
  const data = await invoke(input.supabase, 'update_survey_question_for_owner_v1', { ...ids, p_question_id: questionId, p_expected_question: z.json().parse(input.existing), p_question: { ...normalized.question, position } }, contextualSurveyQuestionMutationSchema, input.retryBudget)
  if (data.question.id !== questionId || data.question.survey_id !== ids.p_survey_id) throw unavailable()
  return data
}

export async function deleteContextualSurveyQuestion(input: Context & { questionId: string }) {
  return invoke(input.supabase, 'delete_survey_question_for_owner_v1', { ...identity(input), p_question_id: z.string().uuid().parse(input.questionId).toLowerCase() }, contextualSurveyDeleteSchema, input.retryBudget)
}

export async function respondToContextualSurvey(input: Context & { detail: { survey: { classroom_id: string }; questions: SurveyQuestion[] }; responses: Record<string, unknown> }) {
  const normalized = validateSurveyResponses(input.detail.questions, input.responses)
  if (!normalized.valid) throw new ApiError(400, normalized.error)
  if (!input.detail.questions.length) throw new ApiError(400, 'All questions must be answered')
  const responses = Object.fromEntries(input.detail.questions.map(question => {
    const answer = normalized.responses[question.id]
    if (answer.question_type !== 'link') return [question.id, answer]
    // Use the exact raw value already accepted by the shared canonical validator.
    // This evidence belongs only to the service RPC, never persisted/returned.
    const raw = input.responses[question.id]
    const text = typeof raw === 'string' ? raw : z.object({ response_text: z.string() }).parse(raw).response_text
    return [question.id, { ...answer, raw_utf16_length: text.trim().length }]
  }))
  return invoke(input.supabase, 'respond_to_survey_for_member_v1', { ...identity(input), p_classroom_id: input.detail.survey.classroom_id,
    p_expected_questions: z.json().parse(input.detail.questions), p_responses: responses }, contextualSurveyRespondSchema, input.retryBudget)
}
