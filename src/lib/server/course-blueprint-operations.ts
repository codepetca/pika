import { createHash, randomUUID } from 'node:crypto'
import { addDays, format, isValid, parse } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildAssignmentInstructionFields } from '@/lib/assignment-instructions'
import { normalizeAssignmentSubmissionRequirementDrafts } from '@/lib/assignment-submission-requirements'
import { generateClassDays, generateClassDaysFromRange, getSemesterDates } from '@/lib/calendar'
import { CLASSROOM_THEME_COLORS } from '@/lib/classroom-theme'
import { buildLessonPlanContentFields } from '@/lib/lesson-plan-content'
import { markdownToTiptapContent } from '@/lib/limited-markdown'
import {
  DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
} from '@/lib/course-site-publishing'
import type {
  CourseBlueprintAssignment,
  CourseBlueprintDetail,
  CreateClassroomFromBlueprintInput,
  Semester,
  TestDraftContent,
} from '@/types'
import { parseDatabaseJson } from '@/lib/validations/database-json'
import type { Database } from '@/types/database'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const dateTimeSchema = z.string().datetime({ offset: true })
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
const uuidSchema = z.string().uuid()

const plannedSiteConfigSchema = z.object({
  overview: z.boolean(),
  outline: z.boolean(),
  resources: z.boolean(),
  assignments: z.boolean(),
  tests: z.boolean(),
  lesson_plans: z.boolean(),
}).strict()

const actualSiteConfigSchema = plannedSiteConfigSchema.extend({
  announcements: z.boolean(),
  lesson_plan_scope: z.enum(['current_week', 'one_week_ahead', 'all']),
}).strict()

const submissionRequirementSchema = z.object({
  type: z.enum(['repo_link', 'link', 'image']),
  label: z.string().min(1),
  instructions: z.string(),
  required: z.boolean(),
  position: z.number().int().nonnegative(),
  validation_policy_json: z.record(z.string(), z.unknown()),
}).strict()

const blueprintAssignmentWriteSchema = z.object({
  title: z.string().min(1),
  instructions_markdown: z.string(),
  submission_requirements_json: z.array(submissionRequirementSchema),
  default_due_days: z.number().int(),
  default_due_time: timeSchema,
  points_possible: z.number().positive().nullable(),
  gradebook_weight: z.number().int().min(1).max(999),
  include_in_final: z.boolean(),
  is_draft: z.boolean(),
  position: z.number().int(),
}).strict()

const blueprintAssessmentWriteSchema = z.object({
  assessment_type: z.literal('test'),
  title: z.string().min(1),
  content: z.record(z.string(), z.unknown()),
  documents: z.array(z.unknown()),
  points_possible: z.number().positive().nullable(),
  gradebook_weight: z.number().int().min(1).max(999),
  include_in_final: z.boolean(),
  position: z.number().int(),
}).strict()

const lessonTemplateWriteSchema = z.object({
  title: z.string(),
  content_markdown: z.string(),
  position: z.number().int(),
}).strict()

export const createBlueprintWritePlanSchema = z.object({
  blueprint: z.object({
    title: z.string().min(1),
    subject: z.string(),
    grade_level: z.string(),
    course_code: z.string(),
    term_template: z.string(),
    overview_markdown: z.string(),
    outline_markdown: z.string(),
    resources_markdown: z.string(),
    planned_site_slug: z.string().nullable(),
    planned_site_published: z.boolean(),
    planned_site_config: plannedSiteConfigSchema,
  }).strict(),
  assignments: z.array(blueprintAssignmentWriteSchema),
  assessments: z.array(blueprintAssessmentWriteSchema),
  lesson_templates: z.array(lessonTemplateWriteSchema),
  manifest_version: z.string().min(1),
  source_package_exported_at: dateTimeSchema.nullable(),
}).strict()

export type CreateBlueprintWritePlan = z.infer<typeof createBlueprintWritePlanSchema>

const classroomAssignmentWriteSchema = z.object({
  title: z.string().min(1),
  instructions_markdown: z.string(),
  description: z.string(),
  rich_instructions: z.unknown(),
  due_at: dateTimeSchema,
  position: z.number().int(),
  points_possible: z.number().positive().nullable(),
  gradebook_weight: z.number().int().min(1).max(999),
  include_in_final: z.boolean(),
  submission_requirements: z.array(submissionRequirementSchema),
}).strict()

const testQuestionWriteSchema = z.object({
  question_type: z.enum(['multiple_choice', 'open_response']),
  question_text: z.string(),
  options: z.array(z.string()),
  correct_option: z.number().int().nullable(),
  answer_key: z.string().nullable(),
  sample_solution: z.string().nullable(),
  points: z.number().positive(),
  response_max_chars: z.number().int().min(1).max(20000),
  response_monospace: z.boolean(),
  position: z.number().int().nonnegative(),
}).strict()

const classroomTestWriteSchema = z.object({
  title: z.string().min(1),
  position: z.number().int(),
  show_results: z.boolean(),
  documents: z.array(z.unknown()),
  points_possible: z.number().positive().nullable(),
  gradebook_weight: z.number().int().min(1).max(999),
  include_in_final: z.boolean(),
  questions: z.array(testQuestionWriteSchema),
  draft_content: z.record(z.string(), z.unknown()),
}).strict()

export const instantiateBlueprintWritePlanSchema = z.object({
  expected_content_revision: z.number().int().positive(),
  manifest_version: z.string().min(1),
  classroom: z.object({
    title: z.string().min(1),
    class_code: z.string().trim().min(1),
    term_label: z.string().nullable(),
    theme_color: z.enum(CLASSROOM_THEME_COLORS),
    start_date: dateSchema,
    end_date: dateSchema,
    course_overview_markdown: z.string(),
    course_outline_markdown: z.string(),
    actual_site_config: actualSiteConfigSchema,
  }).strict(),
  class_days: z.array(z.object({ date: dateSchema }).strict()).min(1),
  resources_content: z.unknown().nullable(),
  assignments: z.array(classroomAssignmentWriteSchema),
  tests: z.array(classroomTestWriteSchema),
  lesson_plans: z.array(z.object({
    date: dateSchema,
    content_markdown: z.string(),
    content: z.unknown(),
  }).strict()),
  overflow_lesson_templates: z.array(z.string()),
}).strict()

export type InstantiateBlueprintWritePlan = z.infer<typeof instantiateBlueprintWritePlanSchema>

const operationCountsSchema = z.object({
  assignments: z.number().int().nonnegative(),
  assessments: z.number().int().nonnegative(),
  lesson_templates: z.number().int().nonnegative(),
  class_days: z.number().int().nonnegative().optional(),
  submission_requirements: z.number().int().nonnegative().optional(),
  questions: z.number().int().nonnegative().optional(),
}).strict()

const blueprintOperationSuccessSchema = z.object({
  ok: z.literal(true),
  status: z.literal(201),
  operation_id: uuidSchema,
  operation_type: z.enum(['import', 'capture', 'instantiate']),
  replayed: z.boolean(),
  blueprint_id: uuidSchema.optional(),
  classroom_id: uuidSchema.optional(),
  source_revision: z.number().int().positive().optional(),
  result_content_revision: z.number().int().positive().optional(),
  counts: operationCountsSchema,
  lesson_mapping: z.object({
    applied_lesson_templates: z.number().int().nonnegative(),
    overflow_lesson_templates: z.array(z.string()),
  }).strict().optional(),
}).strict()

const blueprintOperationFailureSchema = z.object({
  ok: z.literal(false),
  status: z.number().int().min(400).max(599),
  operation_id: uuidSchema,
  operation_type: z.enum(['import', 'capture', 'instantiate']),
  error_code: z.string().min(1),
  error: z.string().min(1),
  retryable: z.boolean(),
}).strict()

export const blueprintOperationResultSchema = z.discriminatedUnion('ok', [
  blueprintOperationSuccessSchema,
  blueprintOperationFailureSchema,
])

export type BlueprintOperationResult = z.infer<typeof blueprintOperationResultSchema>

type BlueprintRpcName =
  | 'create_course_blueprint_atomic'
  | 'instantiate_course_blueprint_atomic'
type BlueprintRpcArgs<Name extends BlueprintRpcName> =
  Database['public']['Functions'][Name]['Args']
type SupabaseRpcClient = Pick<SupabaseClient<Database>, 'rpc'>

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  )
}

export function hashBlueprintOperationRequest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')
}

export function resolveBlueprintOperationId(value: string | null | undefined): string {
  if (!value) return randomUUID()
  return uuidSchema.parse(value.trim())
}

export function isMissingBlueprintOperationRpcError(error: {
  code?: string
  message?: string
} | null | undefined): boolean {
  if (!error) return false
  const message = (error.message || '').toLowerCase()
  return (
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    message.includes('create_course_blueprint_atomic') ||
    message.includes('instantiate_course_blueprint_atomic')
  )
}

function emitBlueprintOperationMetric(result: BlueprintOperationResult, durationMs: number) {
  console.info('[blueprint-operation]', JSON.stringify({
    operation_id: result.operation_id,
    operation_type: result.operation_type,
    status: result.ok ? 'completed' : 'failed',
    replayed: result.ok ? result.replayed : false,
    duration_ms: durationMs,
    counts: result.ok ? result.counts : undefined,
    error_code: result.ok ? undefined : result.error_code,
    retryable: result.ok ? undefined : result.retryable,
  }))
}

async function executeBlueprintOperation<Name extends BlueprintRpcName>(
  supabase: SupabaseRpcClient,
  rpcName: Name,
  args: BlueprintRpcArgs<Name>,
  operationId: string,
  operationType: 'import' | 'capture' | 'instantiate',
): Promise<BlueprintOperationResult> {
  const startedAt = Date.now()
  const { data, error } = await supabase.rpc(rpcName, args)

  if (error) {
    const result: BlueprintOperationResult = isMissingBlueprintOperationRpcError(error)
      ? {
          ok: false,
          status: 503,
          operation_id: operationId,
          operation_type: operationType,
          error_code: 'atomic_blueprint_migration_required',
          error: 'Blueprint operations require migration 081 to be applied',
          retryable: true,
        }
      : {
          ok: false,
          status: 500,
          operation_id: operationId,
          operation_type: operationType,
          error_code: 'blueprint_rpc_failed',
          error: 'Atomic blueprint operation failed',
          retryable: true,
        }
    emitBlueprintOperationMetric(result, Date.now() - startedAt)
    return result
  }

  const parsed = blueprintOperationResultSchema.safeParse(data)
  const result: BlueprintOperationResult = parsed.success
    ? parsed.data
    : {
        ok: false,
        status: 500,
        operation_id: operationId,
        operation_type: operationType,
        error_code: 'blueprint_rpc_contract_invalid',
        error: 'Atomic blueprint operation returned an invalid response',
        retryable: false,
      }
  emitBlueprintOperationMetric(result, Date.now() - startedAt)
  return result
}

export async function createCourseBlueprintAtomic(args: {
  supabase: SupabaseRpcClient
  operationId: string
  teacherId: string
  operationType: 'import' | 'capture'
  sourceClassroomId?: string | null
  expectedSourceRevision?: number | null
  plan: CreateBlueprintWritePlan
}): Promise<BlueprintOperationResult> {
  const plan = createBlueprintWritePlanSchema.parse(args.plan)
  const expectedSourceRevision = z.number().int().positive().nullable().parse(
    args.expectedSourceRevision ?? null,
  )
  const hasCaptureSource = Boolean(args.sourceClassroomId && expectedSourceRevision)
  if ((args.operationType === 'capture') !== hasCaptureSource) {
    throw new Error('Capture operations require a source classroom and revision')
  }
  const requestSha256 = hashBlueprintOperationRequest({
    operation_type: args.operationType,
    source_classroom_id: args.sourceClassroomId ?? null,
    plan,
  })

  return executeBlueprintOperation(
    args.supabase,
    'create_course_blueprint_atomic',
    {
      p_operation_id: args.operationId,
      p_teacher_id: args.teacherId,
      p_operation_type: args.operationType,
      p_request_sha256: requestSha256,
      p_source_classroom_id: args.sourceClassroomId ?? null,
      p_expected_source_revision: expectedSourceRevision,
      p_plan: parseDatabaseJson(plan),
    },
    args.operationId,
    args.operationType,
  )
}

export async function instantiateCourseBlueprintAtomic(args: {
  supabase: SupabaseRpcClient
  operationId: string
  teacherId: string
  blueprintId: string
  plan: InstantiateBlueprintWritePlan
}): Promise<BlueprintOperationResult> {
  const plan = instantiateBlueprintWritePlanSchema.parse(args.plan)
  const requestSha256 = hashBlueprintOperationRequest({
    blueprint_id: args.blueprintId,
    plan,
  })

  return executeBlueprintOperation(
    args.supabase,
    'instantiate_course_blueprint_atomic',
    {
      p_operation_id: args.operationId,
      p_teacher_id: args.teacherId,
      p_blueprint_id: args.blueprintId,
      p_request_sha256: requestSha256,
      p_expected_content_revision: plan.expected_content_revision,
      p_plan: parseDatabaseJson(plan),
    },
    args.operationId,
    'instantiate',
  )
}

function normalizeBlueprintAssignment(
  assignment: Omit<CourseBlueprintAssignment, 'id' | 'course_blueprint_id' | 'created_at' | 'updated_at'>,
) {
  return {
    title: assignment.title,
    instructions_markdown: assignment.instructions_markdown,
    submission_requirements_json: normalizeRequirementsForBlueprint(
      assignment.submission_requirements_json || [],
    ),
    default_due_days: assignment.default_due_days,
    default_due_time: assignment.default_due_time,
    points_possible: assignment.points_possible,
    gradebook_weight: assignment.gradebook_weight ?? 10,
    include_in_final: assignment.include_in_final,
    is_draft: assignment.is_draft,
    position: assignment.position,
  }
}

// Markdown parsers carry an `id` for matching against existing rows. Creation
// plans never use it, and the write schemas are strict, so pick only the
// fields the plan declares.
function normalizeBlueprintAssessment(assessment: CreateBlueprintWritePlan['assessments'][number]) {
  return {
    assessment_type: assessment.assessment_type,
    title: assessment.title,
    content: assessment.content,
    documents: assessment.documents,
    points_possible: assessment.points_possible,
    gradebook_weight: assessment.gradebook_weight ?? 10,
    include_in_final: assessment.include_in_final,
    position: assessment.position,
  }
}

function normalizeBlueprintLessonTemplate(template: CreateBlueprintWritePlan['lesson_templates'][number]) {
  return {
    title: template.title,
    content_markdown: template.content_markdown,
    position: template.position,
  }
}

function normalizeRequirementsForBlueprint(
  requirements: CourseBlueprintAssignment['submission_requirements_json'],
) {
  return normalizeAssignmentSubmissionRequirementDrafts(requirements).map((requirement) => ({
    type: requirement.type,
    label: requirement.label || '',
    instructions: requirement.instructions || '',
    required: requirement.required !== false,
    position: requirement.position ?? 0,
    validation_policy_json: requirement.validation_policy_json || {},
  }))
}

export function buildCreateBlueprintWritePlan(args: {
  blueprint: CreateBlueprintWritePlan['blueprint']
  assignments: Array<Omit<CourseBlueprintAssignment, 'id' | 'course_blueprint_id' | 'created_at' | 'updated_at'>>
  assessments: CreateBlueprintWritePlan['assessments']
  lessonTemplates: CreateBlueprintWritePlan['lesson_templates']
  manifestVersion: string
  sourcePackageExportedAt?: string | null
}): CreateBlueprintWritePlan {
  return createBlueprintWritePlanSchema.parse({
    blueprint: args.blueprint,
    assignments: args.assignments.map(normalizeBlueprintAssignment),
    assessments: args.assessments.map(normalizeBlueprintAssessment),
    lesson_templates: args.lessonTemplates.map(normalizeBlueprintLessonTemplate),
    manifest_version: args.manifestVersion,
    source_package_exported_at: args.sourcePackageExportedAt ?? null,
  })
}

function parseExactDate(value: string): Date | null {
  const parsed = parse(value, 'yyyy-MM-dd', new Date())
  return isValid(parsed) && format(parsed, 'yyyy-MM-dd') === value ? parsed : null
}

function buildClassroomCalendar(input: CreateClassroomFromBlueprintInput):
  | { ok: true; startDate: string; endDate: string; classDayDates: string[] }
  | { ok: false; status: 400; error: string } {
  const hasSemesterParams = Boolean(input.semester && input.year)
  const hasCustomParams = Boolean(input.start_date && input.end_date)

  if (hasSemesterParams === hasCustomParams) {
    return {
      ok: false,
      status: 400,
      error: 'Provide either (semester + year) or (start_date + end_date)',
    }
  }

  if (hasSemesterParams) {
    const semester = input.semester as Semester
    const year = input.year as number
    const semesterDates = getSemesterDates(semester, year)
    return {
      ok: true,
      startDate: format(semesterDates.start, 'yyyy-MM-dd'),
      endDate: format(semesterDates.end, 'yyyy-MM-dd'),
      classDayDates: generateClassDays(semester, year),
    }
  }

  const start = parseExactDate(input.start_date as string)
  const end = parseExactDate(input.end_date as string)
  if (!start || !end || start >= end) {
    return { ok: false, status: 400, error: 'end_date must be after start_date' }
  }

  return {
    ok: true,
    startDate: format(start, 'yyyy-MM-dd'),
    endDate: format(end, 'yyyy-MM-dd'),
    classDayDates: generateClassDaysFromRange(start, end),
  }
}

function buildDueAt(startDate: string, defaultDueDays: number, defaultDueTime: string): string {
  const dueDate = addDays(parse(startDate, 'yyyy-MM-dd', new Date()), defaultDueDays)
  const [hours, minutes] = defaultDueTime.split(':').map(Number)
  const localDue = new Date(
    dueDate.getFullYear(),
    dueDate.getMonth(),
    dueDate.getDate(),
    Number.isFinite(hours) ? hours : 23,
    Number.isFinite(minutes) ? minutes : 59,
    0,
    0,
  )
  return fromZonedTime(localDue, 'America/Toronto').toISOString()
}

function generateClassCode(operationId: string): string {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const digest = createHash('sha256').update(operationId).digest()
  return Array.from(
    { length: 6 },
    (_, index) => characters.charAt(digest[index] % characters.length),
  ).join('')
}

export function buildInstantiateBlueprintWritePlan(args: {
  detail: CourseBlueprintDetail
  input: CreateClassroomFromBlueprintInput
  themeColor: (typeof CLASSROOM_THEME_COLORS)[number]
  manifestVersion: string
  operationId: string
}):
  | { ok: true; plan: InstantiateBlueprintWritePlan }
  | { ok: false; status: 400; error: string } {
  const calendar = buildClassroomCalendar(args.input)
  if (!calendar.ok) return calendar

  const classCode = args.input.classCode?.trim() || generateClassCode(args.operationId)
  const classDays = calendar.classDayDates.map((date) => ({ date }))
  const lessonTemplates = [...args.detail.lesson_templates]
    .sort((left, right) => left.position - right.position)
  const appliedTemplates = lessonTemplates.slice(0, classDays.length)
  const overflowTemplates = lessonTemplates.slice(appliedTemplates.length)

  const plan = instantiateBlueprintWritePlanSchema.parse({
    expected_content_revision: args.detail.content_revision,
    manifest_version: args.manifestVersion,
    classroom: {
      title: args.input.title,
      class_code: classCode,
      term_label: args.input.termLabel?.trim() || null,
      theme_color: args.themeColor,
      start_date: calendar.startDate,
      end_date: calendar.endDate,
      course_overview_markdown: args.detail.overview_markdown,
      course_outline_markdown: args.detail.outline_markdown,
      actual_site_config: DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
    },
    class_days: classDays,
    resources_content: args.detail.resources_markdown.trim()
      ? markdownToTiptapContent(args.detail.resources_markdown)
      : null,
    assignments: args.detail.assignments.map((assignment) => {
      const instructionFields = buildAssignmentInstructionFields(assignment.instructions_markdown)
      return {
        title: assignment.title,
        instructions_markdown: instructionFields.instructions_markdown,
        description: instructionFields.description,
        rich_instructions: instructionFields.rich_instructions,
        due_at: buildDueAt(
          calendar.startDate,
          assignment.default_due_days,
          assignment.default_due_time,
        ),
        position: assignment.position,
        points_possible: assignment.points_possible,
        gradebook_weight: assignment.gradebook_weight ?? 10,
        include_in_final: assignment.include_in_final,
        submission_requirements: normalizeRequirementsForBlueprint(
          assignment.submission_requirements_json || [],
        ),
      }
    }),
    tests: args.detail.assessments.map((assessment) => {
      const draft = assessment.content as unknown as TestDraftContent
      return {
        title: assessment.title,
        position: assessment.position,
        show_results: draft.show_results,
        documents: assessment.documents || [],
        points_possible: assessment.points_possible,
        gradebook_weight: assessment.gradebook_weight ?? 10,
        include_in_final: assessment.include_in_final,
        questions: draft.questions.map((question, index) => ({
          question_type: question.question_type,
          question_text: question.question_text,
          options: question.options,
          correct_option: question.correct_option,
          answer_key: question.answer_key,
          sample_solution: question.sample_solution,
          points: question.points,
          response_max_chars: question.response_max_chars,
          response_monospace: question.response_monospace,
          position: index,
        })),
        draft_content: draft as unknown as Record<string, unknown>,
      }
    }),
    lesson_plans: appliedTemplates.map((lesson, index) => {
      const fields = buildLessonPlanContentFields(lesson.content_markdown)
      return {
        date: classDays[index].date,
        content_markdown: fields.content_markdown,
        content: fields.content,
      }
    }),
    overflow_lesson_templates: overflowTemplates.map((lesson) => lesson.title),
  })

  return { ok: true, plan }
}
