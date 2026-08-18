import { z } from 'zod'

export const COURSE_BLUEPRINT_PACKAGE_FORMAT = 'pika.course-package' as const
export const COURSE_BLUEPRINT_PACKAGE_EXTENSION = '.course-package.tar' as const
export const COURSE_BLUEPRINT_PACKAGE_VERSION = '5' as const
export const COURSE_BLUEPRINT_SUPPORTED_PACKAGE_VERSIONS = ['2', '3', '4', '5'] as const
export const COURSE_BLUEPRINT_PACKAGE_MAX_BYTES = 8 * 1024 * 1024
export const COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES = 2 * 1024 * 1024
export const COURSE_BLUEPRINT_PACKAGE_MAX_FILE_COUNT = 10

export type CoursePackageVersion =
  (typeof COURSE_BLUEPRINT_SUPPORTED_PACKAGE_VERSIONS)[number]

export const COURSE_BLUEPRINT_LEGACY_PACKAGE_FILE_NAMES = [
  'course-overview.md',
  'course-outline.md',
  'resources.md',
  'assignments.md',
  'tests.md',
  'lesson-plans.md',
] as const

export const COURSE_BLUEPRINT_CURRENT_PACKAGE_FILE_NAMES = [
  ...COURSE_BLUEPRINT_LEGACY_PACKAGE_FILE_NAMES,
  'classwork-materials.md',
  'surveys.md',
] as const

const textEncoder = new TextEncoder()
export const coursePackageFileContentSchema = z.string().superRefine((value, ctx) => {
  if (textEncoder.encode(value).byteLength > COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES) {
    ctx.addIssue({
      code: 'custom',
      message: 'Course package file exceeds the 2 MiB limit',
      params: { coursePackageIssue: 'file_too_large' },
    })
  }
})

const plannedCourseSiteConfigShape = {
  overview: z.boolean(),
  outline: z.boolean(),
  resources: z.boolean(),
  assignments: z.boolean(),
  tests: z.boolean(),
  lesson_plans: z.boolean(),
}

const v2PlannedCourseSiteConfigSchema = z.object({
  ...plannedCourseSiteConfigShape,
  quizzes: z.boolean(),
}).strict()

const v3PlannedCourseSiteConfigSchema = z.object({
  ...plannedCourseSiteConfigShape,
  quizzes: z.boolean().optional(),
}).strict()

const plannedCourseSiteConfigSchema = z.object(plannedCourseSiteConfigShape).strict()

const coursePackageManifestBaseShape = {
  exported_at: z.string().datetime({ offset: true }),
  title: z.string(),
  subject: z.string(),
  grade_level: z.string(),
  course_code: z.string(),
  term_template: z.string(),
  planned_site_slug: z.string().nullable().optional(),
  planned_site_published: z.boolean().optional(),
}

export const coursePackageManifestV2Schema = z.object({
  version: z.literal('2'),
  ...coursePackageManifestBaseShape,
  planned_site_config: v2PlannedCourseSiteConfigSchema.optional(),
}).strict()

export const coursePackageManifestV3Schema = z.object({
  version: z.literal('3'),
  ...coursePackageManifestBaseShape,
  planned_site_config: v3PlannedCourseSiteConfigSchema.optional(),
}).strict()

export const coursePackageManifestV4Schema = z.object({
  version: z.literal('4'),
  ...coursePackageManifestBaseShape,
  planned_site_config: plannedCourseSiteConfigSchema.optional(),
}).strict()

export const coursePackageManifestV5Schema = z.object({
  version: z.literal('5'),
  ...coursePackageManifestBaseShape,
  blueprint_id: z.string().uuid(),
  source_draft_revision: z.number().int().nonnegative(),
  blueprint_version_id: z.string().uuid().nullable().optional(),
  blueprint_version_number: z.number().int().positive().nullable().optional(),
  editing_session_id: z.string().uuid().optional(),
  grading: z.object({
    use_weights: z.boolean(),
    assignments_weight: z.number().int().min(0).max(100),
    tests_weight: z.number().int().min(0).max(100),
  }).strict().superRefine((value, ctx) => {
    if (value.use_weights && value.assignments_weight + value.tests_weight !== 100) {
      ctx.addIssue({
        code: 'custom',
        message: 'Weighted grading categories must total 100',
      })
    }
  }),
  planned_site_config: plannedCourseSiteConfigSchema.optional(),
}).strict()

export const coursePackageManifestSchema = z.discriminatedUnion('version', [
  coursePackageManifestV2Schema,
  coursePackageManifestV3Schema,
  coursePackageManifestV4Schema,
  coursePackageManifestV5Schema,
])

const legacyCoursePackageFilesShape = {
  'course-overview.md': coursePackageFileContentSchema,
  'course-outline.md': coursePackageFileContentSchema,
  'resources.md': coursePackageFileContentSchema,
  'assignments.md': coursePackageFileContentSchema,
  'tests.md': coursePackageFileContentSchema,
  'lesson-plans.md': coursePackageFileContentSchema,
}

export const coursePackageV2BundleSchema = z.object({
  manifest: coursePackageManifestV2Schema,
  files: z.object({
    ...legacyCoursePackageFilesShape,
    'quizzes.md': coursePackageFileContentSchema.optional(),
  }).strict(),
}).strict()

export const coursePackageV3BundleSchema = z.object({
  manifest: coursePackageManifestV3Schema,
  files: z.object(legacyCoursePackageFilesShape).strict(),
}).strict()

export const coursePackageV4BundleSchema = z.object({
  manifest: coursePackageManifestV4Schema,
  files: z.object(legacyCoursePackageFilesShape).strict(),
}).strict()

export const coursePackageV5BundleSchema = z.object({
  manifest: coursePackageManifestV5Schema,
  files: z.object({
    ...legacyCoursePackageFilesShape,
    'classwork-materials.md': coursePackageFileContentSchema,
    'surveys.md': coursePackageFileContentSchema,
  }).strict(),
}).strict()

export const coursePackageBundleSchema = z.union([
  coursePackageV2BundleSchema,
  coursePackageV3BundleSchema,
  coursePackageV4BundleSchema,
  coursePackageV5BundleSchema,
])

export const COURSE_BLUEPRINT_PACKAGE_CONTRACTS = {
  '2': {
    version: '2',
    requiredFiles: COURSE_BLUEPRINT_LEGACY_PACKAGE_FILE_NAMES,
    allowedFiles: [...COURSE_BLUEPRINT_LEGACY_PACKAGE_FILE_NAMES, 'quizzes.md'],
    manifestSchema: coursePackageManifestV2Schema,
    bundleSchema: coursePackageV2BundleSchema,
  },
  '3': {
    version: '3',
    requiredFiles: COURSE_BLUEPRINT_LEGACY_PACKAGE_FILE_NAMES,
    allowedFiles: COURSE_BLUEPRINT_LEGACY_PACKAGE_FILE_NAMES,
    manifestSchema: coursePackageManifestV3Schema,
    bundleSchema: coursePackageV3BundleSchema,
  },
  '4': {
    version: '4',
    requiredFiles: COURSE_BLUEPRINT_LEGACY_PACKAGE_FILE_NAMES,
    allowedFiles: COURSE_BLUEPRINT_LEGACY_PACKAGE_FILE_NAMES,
    manifestSchema: coursePackageManifestV4Schema,
    bundleSchema: coursePackageV4BundleSchema,
  },
  '5': {
    version: '5',
    requiredFiles: COURSE_BLUEPRINT_CURRENT_PACKAGE_FILE_NAMES,
    allowedFiles: COURSE_BLUEPRINT_CURRENT_PACKAGE_FILE_NAMES,
    manifestSchema: coursePackageManifestV5Schema,
    bundleSchema: coursePackageV5BundleSchema,
  },
} as const

export type CoursePackageManifestV2 = z.infer<typeof coursePackageManifestV2Schema>
export type CoursePackageManifestV3 = z.infer<typeof coursePackageManifestV3Schema>
export type CoursePackageManifestV4 = z.infer<typeof coursePackageManifestV4Schema>
export type CoursePackageManifestV5 = z.infer<typeof coursePackageManifestV5Schema>
export type CoursePackageManifest = z.infer<typeof coursePackageManifestSchema>
export type CoursePackageRawV2 = z.infer<typeof coursePackageV2BundleSchema>
export type CoursePackageRawV3 = z.infer<typeof coursePackageV3BundleSchema>
export type CoursePackageRawV4 = z.infer<typeof coursePackageV4BundleSchema>
export type CoursePackageRawV5 = z.infer<typeof coursePackageV5BundleSchema>
export type CoursePackageRawBundle = z.infer<typeof coursePackageBundleSchema>
