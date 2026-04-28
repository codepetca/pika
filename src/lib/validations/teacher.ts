import { z } from 'zod'

const slugSchema = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must use lowercase letters, numbers, and hyphens')

const plannedSiteConfigSchema = z.object({
  overview: z.boolean(),
  outline: z.boolean(),
  resources: z.boolean(),
  assignments: z.boolean(),
  quizzes: z.boolean(),
  tests: z.boolean(),
  lesson_plans: z.boolean(),
})

const actualSiteConfigSchema = plannedSiteConfigSchema.extend({
  announcements: z.boolean(),
  lesson_plan_scope: z.enum(['current_week', 'one_week_ahead', 'all']),
})

/**
 * POST /api/teacher/classrooms
 */
export const createClassroomSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  classCode: z.string().optional(),
  termLabel: z.string().optional(),
  blueprintId: z.string().uuid().optional(),
})

export const createCourseBlueprintSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  subject: z.string().optional().default(''),
  grade_level: z.string().optional().default(''),
  course_code: z.string().optional().default(''),
  term_template: z.string().optional().default(''),
})

export const updateCourseBlueprintSchema = z.object({
  title: z.string().min(1, 'Title is required').optional(),
  subject: z.string().optional(),
  grade_level: z.string().optional(),
  course_code: z.string().optional(),
  term_template: z.string().optional(),
  overview_markdown: z.string().optional(),
  outline_markdown: z.string().optional(),
  resources_markdown: z.string().optional(),
  planned_site_slug: slugSchema.nullable().optional(),
  planned_site_published: z.boolean().optional(),
  planned_site_config: plannedSiteConfigSchema.optional(),
  position: z.number().int().optional(),
}).superRefine((value, ctx) => {
  if (value.planned_site_published && value.planned_site_slug === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A planned site slug is required before publishing the planned site',
      path: ['planned_site_slug'],
    })
  }
})

export const createClassroomFromBlueprintSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  classCode: z.string().optional(),
  termLabel: z.string().optional(),
  semester: z.enum(['semester1', 'semester2']).optional(),
  year: z.number().int().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export const createCourseBlueprintFromClassroomSchema = z.object({
  title: z.string().min(1, 'Title is required').optional(),
})

export const courseBlueprintAiSuggestSchema = z.object({
  target: z.enum(['analyze', 'overview', 'outline', 'resources', 'assignments', 'quizzes', 'tests', 'lesson-plans']),
  prompt: z.string().optional().default(''),
})

export const courseBlueprintAiApplySchema = z.object({
  target: z.enum(['overview', 'outline', 'resources', 'assignments', 'quizzes', 'tests', 'lesson-plans']),
  content: z.string(),
})

export const updateClassroomPublishingSchema = z.object({
  title: z.string().min(1).optional(),
  classCode: z.string().optional(),
  termLabel: z.string().optional(),
  allowEnrollment: z.boolean().optional(),
  archived: z.boolean().optional(),
  lessonPlanVisibility: z.enum(['current_week', 'one_week_ahead', 'all']).optional(),
  actualSiteSlug: slugSchema.nullable().optional(),
  actualSitePublished: z.boolean().optional(),
  actualSiteConfig: actualSiteConfigSchema.optional(),
  courseOverviewMarkdown: z.string().optional(),
  courseOutlineMarkdown: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.actualSitePublished && value.actualSiteSlug === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A public slug is required before publishing the actual course website',
      path: ['actualSiteSlug'],
    })
  }
})

export const blueprintMergeSuggestionQuerySchema = z.object({
  classroomId: z.string().uuid('classroomId must be a UUID'),
})

export const applyBlueprintMergeSchema = z.object({
  classroomId: z.string().uuid(),
  areas: z
    .array(z.enum(['overview', 'outline', 'resources', 'assignments', 'quizzes', 'tests', 'lesson-plans']))
    .min(1, 'Select at least one area to apply'),
})
