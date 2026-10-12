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
  rpc<Name extends SurveyRpcName>(name: Name, args: Database['public']['Functions'][Name]['Args']): PromiseLike<{ data: unknown; error: { code?: string } | null }>
}
type Context = { actorId: string; surveyId: string; supabase?: SurveyRpcClient }
type Permission = 'owner' | 'member'
const unavailable = () => new ApiError(503, 'Survey operation unavailable')

export async function authorizeSharedSurveyActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  return resolveClassroomExperienceAdmission(user).status === 'admitted' ? { mode: 'shared', user } : { mode: 'existing' }
}

async function invoke<Name extends SurveyRpcName, T extends z.ZodType>(client: SurveyRpcClient | undefined, name: Name, args: Database['public']['Functions'][Name]['Args'], schema: T): Promise<z.infer<T>> {
  let result: { data: unknown; error: { code?: string } | null }
  const rpcClient: SurveyRpcClient = client ?? getServiceRoleClient()
  try { result = await rpcClient.rpc(name, args) } catch { throw unavailable() }
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
  return { p_actor_id: parsed.data.actorId, p_survey_id: parsed.data.surveyId }
}

function verifyClassroom(classroom: { id: string; teacher_id: string; archived_at: string | null }, actorId: string, permission: Permission) {
  if (permission === 'owner' ? classroom.teacher_id !== actorId : classroom.teacher_id === actorId || classroom.archived_at !== null) throw unavailable()
}

export async function readContextualSurveyList(input: { actorId: string; classroomId: string; permission: Permission; supabase?: SurveyRpcClient }) {
  const parsed = contextualSurveyClassroomIdentitySchema.safeParse(input)
  if (!parsed.success) throw new ApiError(400, 'Invalid Survey identifiers')
  const data = await invoke(input.supabase, input.permission === 'owner' ? 'get_surveys_for_owner_v1' : 'get_surveys_for_member_v1', {
    p_actor_id: parsed.data.actorId, p_classroom_id: parsed.data.classroomId,
  }, contextualSurveyListSchema)
  verifyClassroom(data.classroom, input.actorId, input.permission)
  if (data.classroom.id !== input.classroomId) throw unavailable()
  const seen = new Set<string>()
  const surveys = data.surveys.map(row => {
    if (row.classroom_id !== input.classroomId || seen.has(row.id)) throw unavailable()
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
  const data = await invoke(input.supabase, input.permission === 'owner' ? 'get_survey_for_owner_v1' : 'get_survey_for_member_v1', identity(input), contextualSurveyDetailSchema)
  verifyClassroom(data.classroom, input.actorId, input.permission)
  if (data.survey.id !== input.surveyId || data.survey.classroom_id !== data.classroom.id) throw unavailable()
  const seen = new Set<string>()
  for (const question of data.questions) {
    if (question.survey_id !== input.surveyId || seen.has(question.id)) throw unavailable()
    seen.add(question.id)
  }
  if (data.responses.some(row => row.survey_id !== input.surveyId || row.student_id !== input.actorId || !seen.has(row.question_id))) throw unavailable()
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
  if (!('classroom' in detail)) throw unavailable()
  if (detail.classroom.archived_at !== null) throw new ApiError(403, 'Classroom is archived')
  return detail
}

export async function readContextualSurveyResults(input: Context & { permission: Permission }) {
  const data = input.permission === 'owner'
    ? await invoke(input.supabase, 'get_survey_results_for_owner_v1', identity(input), contextualSurveyOwnerResultsSchema)
    : await invoke(input.supabase, 'get_survey_results_for_member_v1', identity(input), contextualSurveyMemberResultsSchema)
  verifyClassroom(data.classroom, input.actorId, input.permission)
  if (data.survey.id !== input.surveyId) throw unavailable()
  const { classroom: _classroom, ...payload } = data
  return payload
}

export async function patchContextualSurvey(input: Context & { patch: z.infer<typeof surveyPatchSchema> }) {
  const patch = { ...input.patch, ...(input.patch.opens_at ? { opens_at: new Date(input.patch.opens_at).toISOString() } : {}) }
  const data = await invoke(input.supabase, 'update_survey_for_owner_v1', { ...identity(input), p_patch: patch }, contextualSurveyMutationSchema)
  if (data.survey.id !== input.surveyId) throw unavailable()
  return data
}

export async function deleteContextualSurvey(input: Context) {
  return invoke(input.supabase, 'delete_survey_for_owner_v1', identity(input), contextualSurveyDeleteSchema)
}

export async function createContextualSurveyQuestion(input: Context & { question: z.infer<typeof surveyQuestionSchema> }) {
  const normalized = normalizeSurveyQuestionInput(input.question)
  if (!normalized.valid) throw new ApiError(400, normalized.error)
  const position = input.question.position === undefined ? undefined : Math.max(0, Math.floor(input.question.position))
  const data = await invoke(input.supabase, 'create_survey_question_for_owner_v1', { ...identity(input), p_question: { ...normalized.question, ...(position === undefined ? {} : { position }) } }, contextualSurveyQuestionMutationSchema)
  if (data.question.survey_id !== input.surveyId) throw unavailable()
  return data
}

export async function patchContextualSurveyQuestion(input: Context & { questionId: string; question: z.infer<typeof surveyQuestionSchema>; existing: SurveyQuestion }) {
  if (input.existing.id !== input.questionId || input.existing.survey_id !== input.surveyId) throw new ApiError(404, 'Question not found')
  const normalized = normalizeSurveyQuestionInput({ ...input.existing, ...input.question })
  if (!normalized.valid) throw new ApiError(400, normalized.error)
  const position = input.question.position === undefined ? input.existing.position : Math.max(0, Math.floor(input.question.position))
  const data = await invoke(input.supabase, 'update_survey_question_for_owner_v1', { ...identity(input), p_question_id: z.string().uuid().parse(input.questionId), p_expected_question: z.json().parse(input.existing), p_question: { ...normalized.question, position } }, contextualSurveyQuestionMutationSchema)
  if (data.question.id !== input.questionId || data.question.survey_id !== input.surveyId) throw unavailable()
  return data
}

export async function deleteContextualSurveyQuestion(input: Context & { questionId: string }) {
  return invoke(input.supabase, 'delete_survey_question_for_owner_v1', { ...identity(input), p_question_id: z.string().uuid().parse(input.questionId) }, contextualSurveyDeleteSchema)
}

export async function respondToContextualSurvey(input: Context & { detail: { survey: { classroom_id: string }; questions: SurveyQuestion[] }; responses: Record<string, unknown> }) {
  const normalized = validateSurveyResponses(input.detail.questions, input.responses)
  if (!normalized.valid) throw new ApiError(400, normalized.error)
  if (!input.detail.questions.length) throw new ApiError(400, 'All questions must be answered')
  return invoke(input.supabase, 'respond_to_survey_for_member_v1', { ...identity(input), p_classroom_id: input.detail.survey.classroom_id,
    p_expected_questions: z.json().parse(input.detail.questions), p_responses: normalized.responses }, contextualSurveyRespondSchema)
}
