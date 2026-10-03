import { z } from 'zod'
import { updateClassroomPublishingSchema } from '@/lib/validations/teacher'
import { actualCourseSiteConfigSchema, courseSiteSlugSchema } from '@/lib/validations/course-publishing'
import { classroomFeatureVisibilitySchema } from '@/lib/validations/classroom-feature-visibility'
import { normalizeActualCourseSiteConfig } from '@/lib/course-site-publishing'

const fields = updateClassroomPublishingSchema.shape
const uuid = z.string().uuid().transform(value => value.toLowerCase())
export const contextualClassroomMetadataParamsSchema = z.object({ id: uuid }).strict()
export const contextualClassroomMetadataIdentitySchema = z.object({ actorId: uuid, classroomId: uuid }).strict()
export const contextualClassroomMetadataPatchSchema = z.object({
  title: fields.title, classCode: fields.classCode, termLabel: fields.termLabel,
  allowEnrollment: fields.allowEnrollment, joinPolicy: fields.joinPolicy, themeColor: fields.themeColor,
  lessonPlanVisibility: fields.lessonPlanVisibility, featureVisibility: fields.featureVisibility,
  actualSiteSlug: fields.actualSiteSlug, actualSitePublished: fields.actualSitePublished,
  actualSiteConfig: fields.actualSiteConfig, courseOverviewMarkdown: fields.courseOverviewMarkdown,
  courseOutlineMarkdown: fields.courseOutlineMarkdown,
}).strict().refine(patch => Object.values(patch).some(value => value !== undefined), 'No fields to update')
  .refine(patch => !(patch.actualSitePublished && patch.actualSiteSlug === null), 'A public page address is required before sharing the course guide publicly')
export type ContextualClassroomMetadataPatch = z.infer<typeof contextualClassroomMetadataPatchSchema>

export const contextualClassroomMetadataDBPatchSchema = z.object({
  title: fields.title, class_code: fields.classCode, term_label: fields.termLabel,
  allow_enrollment: fields.allowEnrollment, join_policy: fields.joinPolicy, theme_color: fields.themeColor,
  lesson_plan_visibility: fields.lessonPlanVisibility, feature_visibility: classroomFeatureVisibilitySchema.optional(),
  actual_site_slug: z.string().refine(value => value === value.trim()).pipe(courseSiteSlugSchema).nullable().optional(),
  actual_site_published: fields.actualSitePublished, actual_site_config: actualCourseSiteConfigSchema.strict().optional(),
  course_overview_markdown: fields.courseOverviewMarkdown, course_outline_markdown: fields.courseOutlineMarkdown,
}).strict().refine(patch => Object.values(patch).some(value => value !== undefined), 'No metadata fields to update')

export function normalizeContextualClassroomMetadataPatch(patch: ContextualClassroomMetadataPatch) {
  return contextualClassroomMetadataDBPatchSchema.parse({
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.classCode !== undefined ? { class_code: patch.classCode } : {}),
    ...(patch.termLabel !== undefined ? { term_label: patch.termLabel } : {}),
    ...(patch.allowEnrollment !== undefined ? { allow_enrollment: patch.allowEnrollment } : {}),
    ...(patch.joinPolicy !== undefined ? { join_policy: patch.joinPolicy } : {}),
    ...(patch.themeColor !== undefined ? { theme_color: patch.themeColor } : {}),
    ...(patch.lessonPlanVisibility !== undefined ? { lesson_plan_visibility: patch.lessonPlanVisibility } : {}),
    ...(patch.featureVisibility !== undefined ? { feature_visibility: patch.featureVisibility } : {}),
    ...(patch.actualSiteSlug !== undefined ? { actual_site_slug: patch.actualSiteSlug } : {}),
    ...(patch.actualSitePublished !== undefined ? { actual_site_published: patch.actualSitePublished } : {}),
    ...(patch.actualSiteConfig !== undefined ? { actual_site_config: normalizeActualCourseSiteConfig(patch.actualSiteConfig) } : {}),
    ...(patch.courseOverviewMarkdown !== undefined ? { course_overview_markdown: patch.courseOverviewMarkdown } : {}),
    ...(patch.courseOutlineMarkdown !== undefined ? { course_outline_markdown: patch.courseOutlineMarkdown } : {}),
  })
}

export const contextualClassroomMetadataErrorEnvelopeSchema = z.unknown().refine(value => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.prototype.hasOwnProperty.call(value, 'data') && Object.prototype.hasOwnProperty.call(value, 'error')
)).pipe(z.object({
  data: z.null(), error: z.object({ code: z.string(), message: z.string(), details: z.string().nullable(), hint: z.string().nullable() }).strict(),
  count: z.number().int().nonnegative().nullable().optional(), status: z.number().int().min(400).max(599).optional(), statusText: z.string().optional(),
}).strict())
