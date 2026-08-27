import { z } from 'zod'
import { CLASSROOM_THEME_COLORS } from '@/lib/classroom-theme'
import { validateTestDraftContent } from '@/lib/validations/assessment-drafts'
import { markPortableTestQuestionIdentity } from '@/lib/test-question-identity'
import {
  stripTestDocumentSnapshots,
  validateTestDocumentsPayload,
} from '@/lib/test-documents'
import {
  courseSiteSlugSchema,
  plannedCourseSiteConfigSchema,
} from '@/lib/validations/course-publishing'

const classroomThemeColorSchema = z.enum(CLASSROOM_THEME_COLORS)

export const createCourseBlueprintSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  subject: z.string().optional().default(''),
  grade_level: z.string().optional().default(''),
  course_code: z.string().optional().default(''),
  term_template: z.string().optional().default(''),
})

export const updateCourseBlueprintSchema = z.object({
  authority_mode: z.enum(['pika', 'repository']).optional(),
  title: z.string().min(1, 'Title is required').optional(),
  subject: z.string().optional(),
  grade_level: z.string().optional(),
  course_code: z.string().optional(),
  term_template: z.string().optional(),
  overview_markdown: z.string().optional(),
  outline_markdown: z.string().optional(),
  resources_markdown: z.string().optional(),
  gradebook_use_weights: z.boolean().optional(),
  gradebook_assignments_weight: z.number().int().min(0).max(100).optional(),
  gradebook_tests_weight: z.number().int().min(0).max(100).optional(),
  planned_site_slug: courseSiteSlugSchema.nullable().optional(),
  planned_site_published: z.boolean().optional(),
  planned_site_config: plannedCourseSiteConfigSchema.optional(),
  position: z.number().int().optional(),
}).superRefine((value, ctx) => {
  if (
    value.authority_mode !== undefined
    && Object.keys(value).some((key) => key !== 'authority_mode')
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'Change Blueprint authority separately from course content',
      path: ['authority_mode'],
    })
  }
  if (value.planned_site_published && value.planned_site_slug === null) {
    ctx.addIssue({
      code: 'custom',
      message: 'A planned site slug is required before publishing the planned site',
      path: ['planned_site_slug'],
    })
  }
  const assignmentsWeight = value.gradebook_assignments_weight
  const testsWeight = value.gradebook_tests_weight
  if (
    value.gradebook_use_weights
    && assignmentsWeight !== undefined
    && testsWeight !== undefined
    && assignmentsWeight + testsWeight !== 100
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'Assignment and test weights must total 100%',
      path: ['gradebook_assignments_weight'],
    })
  }
})

export const createClassroomFromBlueprintSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  classCode: z.string().optional(),
  termLabel: z.string().optional(),
  themeColor: classroomThemeColorSchema.optional(),
  semester: z.enum(['semester1', 'semester2']).optional(),
  year: z.number().int().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export const createCourseBlueprintFromClassroomSchema = z.object({
  title: z.string().min(1, 'Title is required').optional(),
})

export const courseBlueprintAiSuggestSchema = z.object({
  target: z.enum([
    'analyze',
    'overview',
    'outline',
    'resources',
    'assignments',
    'tests',
    'lesson-plans',
    'materials',
    'surveys',
    'grading',
  ]),
  prompt: z.string().optional().default(''),
})

export const courseBlueprintAiApplySchema = z.object({
  target: z.enum([
    'overview',
    'outline',
    'resources',
    'assignments',
    'tests',
    'lesson-plans',
    'materials',
    'surveys',
    'grading',
  ]),
  content: z.string(),
})

const blueprintSubmissionRequirementSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(['repo_link', 'link', 'image']),
  label: z.string().nullable().optional(),
  instructions: z.string().nullable().optional(),
  required: z.boolean().nullable().optional(),
  position: z.number().int().nonnegative().nullable().optional(),
  validation_policy_json: z.record(z.string(), z.unknown()).nullable().optional(),
})

const blueprintAssignmentSchema = z.object({
  id: z.string().uuid().optional(),
  artifact_id: z.string().uuid().optional(),
  title: z.string().trim().min(1, 'Assignment title is required'),
  instructions_markdown: z.string(),
  submission_requirements: z.array(blueprintSubmissionRequirementSchema).optional(),
  submission_requirements_json: z.array(blueprintSubmissionRequirementSchema).optional(),
  default_due_days: z.number().int(),
  default_due_time: z.string().regex(
    /^(?:[01]\d|2[0-3]):[0-5]\d$/,
    'default_due_time must use HH:mm in 24-hour time'
  ),
  points_possible: z.number().nonnegative().nullable(),
  gradebook_weight: z.number().int().min(1).max(999).optional(),
  include_in_final: z.boolean(),
  is_draft: z.boolean(),
  track_authenticity: z.boolean().optional().default(false),
  position: z.number().int().nonnegative(),
})

const testDraftContentBoundarySchema = z.unknown().transform((value, ctx) => {
  const result = validateTestDraftContent(value)
  if (!result.valid) {
    ctx.addIssue({ code: 'custom', message: result.error })
    return z.NEVER
  }
  return markPortableTestQuestionIdentity(result.value)
})

const testDocumentsBoundarySchema = z.unknown().transform((value, ctx) => {
  const result = validateTestDocumentsPayload(value)
  if (!result.valid) {
    ctx.addIssue({ code: 'custom', message: result.error })
    return z.NEVER
  }
  return stripTestDocumentSnapshots(result.documents)
})

const blueprintAssessmentSchema = z.object({
  id: z.string().uuid().optional(),
  artifact_id: z.string().uuid().optional(),
  assessment_type: z.literal('test'),
  title: z.string().trim().min(1, 'Test title is required'),
  content: testDraftContentBoundarySchema,
  documents: testDocumentsBoundarySchema,
  points_possible: z.number().positive().nullable().optional(),
  gradebook_weight: z.number().int().min(1).max(999).optional(),
  include_in_final: z.boolean().optional(),
  position: z.number().int().nonnegative(),
})

const blueprintLessonTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  artifact_id: z.string().uuid().optional(),
  title: z.string().trim().min(1, 'Lesson title is required'),
  content_markdown: z.string(),
  position: z.number().int().nonnegative(),
})

const blueprintMaterialSchema = z.object({
  id: z.string().uuid().optional(),
  artifact_id: z.string().uuid().optional(),
  title: z.string().trim().min(1, 'Material title is required'),
  content_markdown: z.string(),
  position: z.number().int().nonnegative(),
})

const blueprintSurveyQuestionSchema = z.object({
  id: z.string().uuid().optional(),
  question_type: z.enum(['multiple_choice', 'short_text', 'link']),
  question_text: z.string().trim().min(1, 'Survey question is required'),
  options: z.array(z.string()),
  response_max_chars: z.number().int().min(1).max(5000),
  position: z.number().int().nonnegative(),
}).superRefine((value, ctx) => {
  if (value.question_type === 'multiple_choice' && value.options.length < 2) {
    ctx.addIssue({
      code: 'custom',
      message: 'Multiple-choice survey questions require at least two options',
      path: ['options'],
    })
  }
  if (value.question_type !== 'multiple_choice' && value.options.length > 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'Text and link survey questions cannot include options',
      path: ['options'],
    })
  }
})

const blueprintSurveySchema = z.object({
  id: z.string().uuid().optional(),
  artifact_id: z.string().uuid().optional(),
  title: z.string().trim().min(1, 'Survey title is required'),
  show_results: z.boolean(),
  dynamic_responses: z.boolean(),
  questions_json: z.array(blueprintSurveyQuestionSchema).max(200),
  position: z.number().int().nonnegative(),
})

export const courseBlueprintAssignmentsBulkSchema = z.object({
  assignments: z.array(blueprintAssignmentSchema).max(500),
})

export const courseBlueprintAssessmentsBulkSchema = z.object({
  assessmentType: z.literal('test').optional(),
  assessments: z.array(blueprintAssessmentSchema).max(200),
})

export const courseBlueprintLessonTemplatesBulkSchema = z.object({
  lesson_templates: z.array(blueprintLessonTemplateSchema).max(500),
})

export const courseBlueprintMaterialsBulkSchema = z.object({
  materials: z.array(blueprintMaterialSchema).max(500),
})

export const courseBlueprintSurveysBulkSchema = z.object({
  surveys: z.array(blueprintSurveySchema).max(200),
})

export const blueprintMergeSuggestionQuerySchema = z.object({
  classroomId: z.string().uuid('classroomId must be a UUID'),
})

export const applyBlueprintMergeSchema = z.object({
  classroomId: z.string().uuid(),
  expectedBlueprintRevision: z.number().int().positive(),
  expectedClassroomRevision: z.number().int().positive(),
  areas: z
    .array(z.enum([
      'overview',
      'outline',
      'resources',
      'grading',
      'assignments',
      'tests',
      'lesson-plans',
      'materials',
      'surveys',
    ]))
    .min(1, 'Select at least one area to apply'),
})
