import { z } from 'zod'

export const courseSiteSlugSchema = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must use lowercase letters, numbers, and hyphens')

export const plannedCourseSiteConfigSchema = z.object({
  overview: z.boolean(),
  outline: z.boolean(),
  resources: z.boolean(),
  assignments: z.boolean(),
  tests: z.boolean(),
  lesson_plans: z.boolean(),
})

export const actualCourseSiteConfigSchema = plannedCourseSiteConfigSchema.extend({
  announcements: z.boolean(),
  lesson_plan_scope: z.enum(['current_week', 'one_week_ahead', 'all']),
})
