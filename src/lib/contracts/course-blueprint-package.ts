import { z } from 'zod'

export const COURSE_BLUEPRINT_PACKAGE_FORMAT = 'pika.course-package' as const
export const COURSE_BLUEPRINT_PACKAGE_EXTENSION = '.course-package.tar' as const
export const COURSE_BLUEPRINT_PACKAGE_VERSION = '3' as const
export const COURSE_BLUEPRINT_SUPPORTED_PACKAGE_VERSIONS = ['2', '3'] as const
export const COURSE_BLUEPRINT_PACKAGE_MAX_BYTES = 8 * 1024 * 1024
export const COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES = 2 * 1024 * 1024
export const COURSE_BLUEPRINT_PACKAGE_MAX_FILE_COUNT = 8

const textEncoder = new TextEncoder()
const coursePackageFileContentSchema = z.string().refine(
  (value) => textEncoder.encode(value).byteLength <= COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES,
  'Course package file exceeds the 2 MiB limit',
)

const plannedCourseSiteConfigSchema = z.object({
  overview: z.boolean(),
  outline: z.boolean(),
  resources: z.boolean(),
  assignments: z.boolean(),
  quizzes: z.boolean(),
  tests: z.boolean(),
  lesson_plans: z.boolean(),
}).strict()

const coursePackageManifestShape = {
  exported_at: z.string().datetime({ offset: true }),
  title: z.string(),
  subject: z.string(),
  grade_level: z.string(),
  course_code: z.string(),
  term_template: z.string(),
  planned_site_slug: z.string().nullable().optional(),
  planned_site_published: z.boolean().optional(),
  planned_site_config: plannedCourseSiteConfigSchema.optional(),
}

const coursePackageManifestV2Schema = z.object({
  version: z.literal('2'),
  ...coursePackageManifestShape,
}).strict()

const coursePackageManifestV3Schema = z.object({
  version: z.literal('3'),
  ...coursePackageManifestShape,
}).strict()

export const coursePackageManifestSchema = z.discriminatedUnion('version', [
  coursePackageManifestV2Schema,
  coursePackageManifestV3Schema,
])

const coursePackageFilesShape = {
  'course-overview.md': coursePackageFileContentSchema.default(''),
  'course-outline.md': coursePackageFileContentSchema.default(''),
  'resources.md': coursePackageFileContentSchema.default(''),
  'assignments.md': coursePackageFileContentSchema.default(''),
  'tests.md': coursePackageFileContentSchema.default(''),
  'lesson-plans.md': coursePackageFileContentSchema.default(''),
}

const coursePackageV2BundleSchema = z.object({
  manifest: coursePackageManifestV2Schema,
  files: z.object({
    ...coursePackageFilesShape,
    'quizzes.md': coursePackageFileContentSchema.default(''),
  }).strict(),
}).strict()

const coursePackageV3BundleSchema = z.object({
  manifest: coursePackageManifestV3Schema,
  files: z.object(coursePackageFilesShape).strict(),
}).strict()

export const coursePackageBundleSchema = z.union([
  coursePackageV2BundleSchema,
  coursePackageV3BundleSchema,
])

export type CoursePackageManifest = z.infer<typeof coursePackageManifestSchema>
