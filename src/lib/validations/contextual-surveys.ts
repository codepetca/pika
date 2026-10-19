import { z } from 'zod'

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const count = z.number().int().nonnegative().max(1000000)
export const contextualSurveyIdentitySchema = z.object({ actorId: uuid, surveyId: uuid })
export const contextualSurveyClassroomIdentitySchema = z.object({ actorId: uuid, classroomId: uuid })
export const contextualSurveyClassroomSchema = z.object({ id: uuid, teacher_id: uuid, archived_at: timestamp.nullable() }).strict()
export const contextualSurveyRowSchema = z.object({
  id: uuid, classroom_id: uuid, title: z.string(), status: z.enum(['draft', 'active', 'closed']),
  opens_at: timestamp.nullable(), show_results: z.boolean(), dynamic_responses: z.boolean(),
  position: z.number().int(), created_by: uuid, created_at: timestamp, updated_at: timestamp,
}).passthrough()
export const contextualSurveyQuestionSchema = z.object({
  id: uuid, survey_id: uuid, question_type: z.enum(['multiple_choice', 'short_text', 'link']),
  question_text: z.string(), options: z.array(z.string()).max(50), response_max_chars: z.number().int().min(1).max(5000),
  position: z.number().int().nonnegative(), created_at: timestamp, updated_at: timestamp,
}).passthrough()
export const contextualSurveyResponseSchema = z.object({
  id: uuid, survey_id: uuid, question_id: uuid, student_id: uuid,
  selected_option: z.number().int().nonnegative().nullable(), response_text: z.string().nullable(),
  submitted_at: timestamp, updated_at: timestamp,
}).strict()
export const contextualSurveyDetailSchema = z.object({
  classroom: contextualSurveyClassroomSchema, survey: contextualSurveyRowSchema,
  questions: z.array(contextualSurveyQuestionSchema).max(10000),
  responses: z.array(contextualSurveyResponseSchema).max(10000),
}).strict()
const stats = z.object({ total_students: count, responded: count, questions_count: count }).strict()
export const contextualSurveyListSchema = z.object({
  classroom: contextualSurveyClassroomSchema,
  surveys: z.array(contextualSurveyRowSchema.extend({ stats: stats.optional(), has_submitted: z.boolean().optional() })).max(10000),
}).strict()
const resultResponse = z.object({ response_id: uuid, response_text: z.string(), submitted_at: timestamp, updated_at: timestamp }).strict()
const result = z.object({
  question_id: uuid, question_type: z.enum(['multiple_choice', 'short_text', 'link']), question_text: z.string(),
  options: z.array(z.string()).max(50), counts: z.array(count).max(50), total_responses: count,
  responses: z.array(resultResponse).max(10000),
}).strict()
const summary = z.object({ id: uuid, title: z.string(), status: z.enum(['draft', 'active', 'closed']), show_results: z.boolean(), dynamic_responses: z.boolean() }).strict()
export const contextualSurveyMemberResultsSchema = z.object({
  classroom: contextualSurveyClassroomSchema, survey: summary, results: z.array(result).max(10000),
}).strict()
export const contextualSurveyOwnerResultsSchema = z.object({
  classroom: contextualSurveyClassroomSchema, survey: summary,
  questions: z.array(contextualSurveyQuestionSchema.pick({ id: true, question_type: true, question_text: true, options: true, response_max_chars: true, position: true })).max(10000),
  results: z.array(result.extend({ responses: z.array(resultResponse.extend({ student_id: uuid, name: z.string().nullable(), email: z.string().nullable() })).max(10000) })).max(10000),
  responders: z.array(z.object({ student_id: uuid, name: z.string().nullable(), email: z.string() }).strict()).max(10000),
  stats: stats.pick({ total_students: true, responded: true }),
}).strict()
export const contextualSurveyMutationSchema = z.object({ survey: contextualSurveyRowSchema }).strict()
export const contextualSurveyQuestionMutationSchema = z.object({ question: contextualSurveyQuestionSchema }).strict()
export const contextualSurveyDeleteSchema = z.object({ success: z.literal(true) }).strict()
export const contextualSurveyRespondSchema = z.object({ success: z.literal(true), updated: z.boolean() }).strict()

export type ContextualSurveyDetail = z.infer<typeof contextualSurveyDetailSchema>
