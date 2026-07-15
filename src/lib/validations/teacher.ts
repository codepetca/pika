import { z } from 'zod'
import { CLASSROOM_THEME_COLORS } from '@/lib/classroom-theme'
import {
  actualCourseSiteConfigSchema,
  courseSiteSlugSchema,
} from '@/lib/validations/course-publishing'

const classroomThemeColorSchema = z.enum(CLASSROOM_THEME_COLORS)

/**
 * POST /api/teacher/classrooms
 */
export const createClassroomSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  classCode: z.string().optional(),
  termLabel: z.string().optional(),
  blueprintId: z.string().uuid().optional(),
  themeColor: classroomThemeColorSchema.optional(),
})

export const updateClassroomPublishingSchema = z.object({
  title: z.string().min(1).optional(),
  classCode: z.string().optional(),
  termLabel: z.string().optional(),
  allowEnrollment: z.boolean().optional(),
  joinPolicy: z.enum(['roster', 'open_join']).optional(),
  archived: z.boolean().optional(),
  themeColor: classroomThemeColorSchema.optional(),
  lessonPlanVisibility: z.enum(['current_week', 'one_week_ahead', 'all']).optional(),
  actualSiteSlug: courseSiteSlugSchema.nullable().optional(),
  actualSitePublished: z.boolean().optional(),
  actualSiteConfig: actualCourseSiteConfigSchema.optional(),
  courseOverviewMarkdown: z.string().optional(),
  courseOutlineMarkdown: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.actualSitePublished && value.actualSiteSlug === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A syllabus slug is required before publishing the syllabus',
      path: ['actualSiteSlug'],
    })
  }
})
