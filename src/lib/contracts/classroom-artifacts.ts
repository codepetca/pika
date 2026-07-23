import { z } from 'zod'
import {
  GRADEX_RESOURCE_TABLES,
} from '@/lib/contracts/classroom-data'
import {
  CLASSROOM_ARCHIVE_V1_RESOURCES,
  CLASSROOM_ARCHIVE_V2_RESOURCES,
} from '@/lib/contracts/classroom-archive-resources'
import {
  COURSE_BLUEPRINT_PACKAGE_EXTENSION,
  COURSE_BLUEPRINT_PACKAGE_FORMAT,
  COURSE_BLUEPRINT_PACKAGE_VERSION,
  COURSE_BLUEPRINT_SUPPORTED_PACKAGE_VERSIONS,
} from '@/lib/contracts/course-blueprint-package'

export const CLASSROOM_ARCHIVE_FORMAT = 'pika.classroom-archive' as const
export const CLASSROOM_ARCHIVE_V1_VERSION = 1 as const
export const CLASSROOM_ARCHIVE_V2_VERSION = 2 as const
export const CLASSROOM_ARCHIVE_CURRENT_EXPORT_VERSION =
  CLASSROOM_ARCHIVE_V1_VERSION
export const CLASSROOM_ARCHIVE_VERSION =
  CLASSROOM_ARCHIVE_CURRENT_EXPORT_VERSION
export const GRADEX_EXTRACT_FORMAT = 'pika.gradex-classroom-extract' as const
export const GRADEX_EXTRACT_VERSION = 2 as const
export const GRADEX_EXTRACT_MAX_RETENTION_DAYS = 90 as const

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const relativeArchivePathSchema = z.string().min(1).refine(
  (value) => {
    const segments = value.split('/')
    return (
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    )
  },
  'Object paths must be canonical relative paths without traversal segments',
)

const checksummedFileSchema = z.object({
  path: relativeArchivePathSchema,
  row_count: z.number().int().nonnegative(),
  byte_size: z.number().int().nonnegative(),
  sha256: sha256Schema,
}).strict()

const resourceFileSchema = checksummedFileSchema.extend({
  table: z.string().min(1),
}).strict()

const storageObjectSchema = z.object({
  bucket: z.enum(['assignment-artifacts', 'submission-images', 'test-documents']),
  source_path: relativeArchivePathSchema,
  archive_path: relativeArchivePathSchema,
  byte_size: z.number().int().nonnegative(),
  sha256: sha256Schema,
  content_type: z.string().min(1).nullable(),
}).strict()

export const classroomArchiveRetentionSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('teacher_managed'),
    delete_after: z.null(),
  }).strict(),
  z.object({
    mode: z.literal('scheduled'),
    delete_after: z.string().datetime({ offset: true }),
  }).strict(),
])

function requireExactResourceSet(
  resources: Array<{ table: string; path: string }>,
  expectedTables: string[],
  context: z.RefinementCtx,
) {
  const actualTables = resources.map((resource) => resource.table)
  const actualSet = new Set(actualTables)
  const expectedSet = new Set(expectedTables)

  for (const [index, table] of actualTables.entries()) {
    if (actualTables.indexOf(table) !== index) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate resource descriptor: ${table}`,
        path: ['resources', index, 'table'],
      })
    }
    if (!expectedSet.has(table)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unexpected resource descriptor: ${table}`,
        path: ['resources', index, 'table'],
      })
    }
    if (resources[index]?.path !== `data/${table}.ndjson`) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Resource ${table} must use its canonical data path`,
        path: ['resources', index, 'path'],
      })
    }
  }

  for (const table of expectedTables) {
    if (!actualSet.has(table)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Missing resource descriptor: ${table}`,
        path: ['resources'],
      })
    }
  }
}

const classroomArchiveManifestBaseSchema = z.object({
  format: z.literal(CLASSROOM_ARCHIVE_FORMAT),
  archive_id: z.string().uuid(),
  classroom_id: z.string().uuid(),
  teacher_id: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
  source: z.object({
    schema_migration: z.string().regex(/^\d{3}(?:_[a-z0-9_]+)?$/),
    app_commit: z.string().regex(/^[a-f0-9]{7,40}$/),
  }).strict(),
  compression: z.literal('tar+gzip'),
  privacy_policy_version: z.literal(1),
  retention: classroomArchiveRetentionSchema,
  content_sha256: sha256Schema,
  resources: z.array(resourceFileSchema),
  actors: checksummedFileSchema,
  storage_objects: z.array(storageObjectSchema),
}).strict()

function createClassroomArchiveManifestSchema<const Version extends 1 | 2>(
  version: Version,
  expectedTables: string[],
) {
  return classroomArchiveManifestBaseSchema.extend({
    version: z.literal(version),
  }).superRefine((manifest, context) => {
    requireExactResourceSet(
      manifest.resources,
      expectedTables,
      context,
    )
    if (manifest.actors.path !== 'actors.ndjson') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Actor snapshots must use actors.ndjson',
        path: ['actors', 'path'],
      })
    }
    const storageSources = new Set<string>()
    const storageArchivePaths = new Set<string>()
    for (const [index, object] of manifest.storage_objects.entries()) {
      if (!object.archive_path.startsWith(`objects/${object.bucket}/`)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Storage object must be namespaced under objects/${object.bucket}/`,
          path: ['storage_objects', index, 'archive_path'],
        })
      }
      const sourceKey = `${object.bucket}\0${object.source_path}`
      if (storageSources.has(sourceKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate storage source: ${object.bucket}/${object.source_path}`,
          path: ['storage_objects', index, 'source_path'],
        })
      }
      if (storageArchivePaths.has(object.archive_path)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate storage archive path: ${object.archive_path}`,
          path: ['storage_objects', index, 'archive_path'],
        })
      }
      storageSources.add(sourceKey)
      storageArchivePaths.add(object.archive_path)
    }
    if (
      manifest.retention.mode === 'scheduled' &&
      Date.parse(manifest.retention.delete_after) <= Date.parse(manifest.created_at)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Scheduled archive deletion must be after archive creation',
        path: ['retention', 'delete_after'],
      })
    }
  })
}

export const classroomArchiveManifestV1Schema = createClassroomArchiveManifestSchema(
  CLASSROOM_ARCHIVE_V1_VERSION,
  CLASSROOM_ARCHIVE_V1_RESOURCES.map((resource) => resource.table),
)

export const classroomArchiveManifestV2Schema = createClassroomArchiveManifestSchema(
  CLASSROOM_ARCHIVE_V2_VERSION,
  CLASSROOM_ARCHIVE_V2_RESOURCES.map((resource) => resource.table),
)

export const classroomArchiveManifestHeaderSchema = z.object({
  format: z.literal(CLASSROOM_ARCHIVE_FORMAT),
  version: z.number().int().positive(),
}).passthrough()

export const CLASSROOM_ARCHIVE_CONTRACTS = {
  [CLASSROOM_ARCHIVE_V1_VERSION]: {
    version: CLASSROOM_ARCHIVE_V1_VERSION,
    resources: CLASSROOM_ARCHIVE_V1_RESOURCES,
    manifestSchema: classroomArchiveManifestV1Schema,
    exportEnabled: true,
    restoreEnabled: true,
    gradexEnabled: true,
  },
  [CLASSROOM_ARCHIVE_V2_VERSION]: {
    version: CLASSROOM_ARCHIVE_V2_VERSION,
    resources: CLASSROOM_ARCHIVE_V2_RESOURCES,
    manifestSchema: classroomArchiveManifestV2Schema,
    exportEnabled: false,
    restoreEnabled: false,
    gradexEnabled: false,
  },
} as const

export const classroomArchiveManifestSchema = classroomArchiveManifestV1Schema

export type ClassroomArchiveManifestV1 = z.infer<
  typeof classroomArchiveManifestV1Schema
>
export type ClassroomArchiveManifestV2 = z.infer<
  typeof classroomArchiveManifestV2Schema
>
export type ClassroomArchiveManifest =
  | ClassroomArchiveManifestV1
  | ClassroomArchiveManifestV2

export function getClassroomArchiveContract(version: number) {
  if (version === CLASSROOM_ARCHIVE_V1_VERSION) {
    return CLASSROOM_ARCHIVE_CONTRACTS[CLASSROOM_ARCHIVE_V1_VERSION]
  }
  if (version === CLASSROOM_ARCHIVE_V2_VERSION) {
    return CLASSROOM_ARCHIVE_CONTRACTS[CLASSROOM_ARCHIVE_V2_VERSION]
  }
  throw new Error(`Unsupported classroom archive version: ${version}`)
}

export function parseClassroomArchiveManifest(value: unknown): ClassroomArchiveManifest {
  const header = classroomArchiveManifestHeaderSchema.parse(value)
  const contract = getClassroomArchiveContract(header.version)
  return contract.manifestSchema.parse(value)
}

export const classroomArchiveActorSnapshotSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['student', 'teacher']),
  profile: z.object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    student_number: z.string().nullable(),
    first_name: z.string(),
    last_name: z.string(),
    created_at: z.string().datetime({ offset: true }),
  }).strict().nullable(),
}).strict()

export type ClassroomArchiveActorSnapshot = z.infer<
  typeof classroomArchiveActorSnapshotSchema
>

const gradexExtractManifestBaseSchema = z.object({
  format: z.literal(GRADEX_EXTRACT_FORMAT),
  version: z.literal(GRADEX_EXTRACT_VERSION),
  extract_id: z.string().uuid(),
  source_archive_ref: sha256Schema,
  classroom_ref: sha256Schema,
  generated_at: z.string().datetime({ offset: true }),
  compression: z.literal('tar+gzip'),
  content_sha256: sha256Schema,
  pseudonymization: z.literal('hmac-sha256-per-extract'),
  timestamp_offsets_from: z.literal('source-archive-created-at'),
  privacy_policy_version: z.literal(2),
  direct_identifiers_removed: z.literal(true),
  direct_identifier_findings: z.literal(0),
  privacy_scanner_version: z.literal(2),
  free_text_included: z.literal(false),
  storage_objects_included: z.literal(false),
  delete_after: z.string().datetime({ offset: true }),
  resources: z.array(resourceFileSchema),
}).strict()

export const gradexExtractManifestSchema = gradexExtractManifestBaseSchema.superRefine(
  (manifest, context) => {
    requireExactResourceSet(manifest.resources, GRADEX_RESOURCE_TABLES, context)
    if (Date.parse(manifest.delete_after) <= Date.parse(manifest.generated_at)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Gradex extract deletion must be after generation',
        path: ['delete_after'],
      })
    }
    if (
      Date.parse(manifest.delete_after) - Date.parse(manifest.generated_at) >
      GRADEX_EXTRACT_MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Gradex extract retention exceeds the version 2 maximum',
        path: ['delete_after'],
      })
    }
  },
)

export type GradexExtractManifest = z.infer<typeof gradexExtractManifestSchema>

export const classroomArchiveRestorePreflightSchema = z.object({
  archive_id: z.string().uuid(),
  target_schema_migration: z.string().regex(/^\d{3}(?:_[a-z0-9_]+)?$/),
  archive_checksum_verified: z.boolean(),
  manifest_verified: z.boolean(),
  resource_checksums_verified: z.boolean(),
  resource_counts_verified: z.boolean(),
  storage_objects_verified: z.boolean(),
  actor_snapshots_verified: z.boolean(),
  schema_adapter_available: z.boolean(),
  unresolved_actor_ids: z.array(z.string().uuid()),
  adapter_chain: z.array(z.string().min(1)).default([]),
}).strict()

export type ClassroomArchiveRestorePreflight = z.infer<
  typeof classroomArchiveRestorePreflightSchema
>

export function isClassroomArchiveRestoreReady(
  preflight: ClassroomArchiveRestorePreflight,
): boolean {
  return (
    preflight.archive_checksum_verified &&
    preflight.manifest_verified &&
    preflight.resource_checksums_verified &&
    preflight.resource_counts_verified &&
    preflight.storage_objects_verified &&
    preflight.actor_snapshots_verified &&
    preflight.schema_adapter_available &&
    preflight.unresolved_actor_ids.length === 0
  )
}

export const COURSE_BLUEPRINT_TRANSFER_CONTRACT = {
  format: COURSE_BLUEPRINT_PACKAGE_FORMAT,
  extension: COURSE_BLUEPRINT_PACKAGE_EXTENSION,
  manifest_version: COURSE_BLUEPRINT_PACKAGE_VERSION,
  supported_import_versions: COURSE_BLUEPRINT_SUPPORTED_PACKAGE_VERSIONS,
  recoverable_classroom_backup: false,
  included_data: [
    'course_metadata',
    'teacher_authored_content',
    'assignment_templates',
    'assessment_templates',
    'lesson_plan_templates',
    'grading_configuration',
    'submission_requirement_templates',
    'planned_site_configuration',
  ],
  excluded_data: [
    'authentication_credentials',
    'classroom_join_credentials',
    'enrollments_and_roster',
    'student_identity',
    'student_work',
    'grades_and_feedback',
    'attendance_and_journals',
    'behavioral_telemetry',
    'runtime_publication_state',
    'storage_objects',
  ],
} as const

export const CLASSROOM_STORAGE_CONTRACT = {
  sources: [
    {
      bucket: 'assignment-artifacts',
      visibility: 'private',
      reference_discovery: 'assignment_submission_artifacts.storage_path',
      copy_policy: 'referenced_only',
    },
    {
      bucket: 'submission-images',
      visibility: 'public',
      reference_discovery: 'embedded_content_urls',
      copy_policy: 'referenced_only',
    },
    {
      bucket: 'test-documents',
      visibility: 'public',
      reference_discovery: 'tests.documents.url_or_snapshot_path',
      copy_policy: 'referenced_only',
    },
  ],
  destinations: [
    {
      bucket: 'classroom-archives',
      visibility: 'private',
      object_template: '{teacher_id}/{classroom_id}/{archive_id}/classroom-v1.tar.gz',
    },
    {
      bucket: 'gradex-analytics-extracts',
      visibility: 'private',
      object_template: '{teacher_id}/{classroom_id}/{extract_id}/gradex-v2.tar.gz',
    },
  ],
} as const

export const CLASSROOM_ARTIFACT_PRIVACY_CONTRACT = {
  course_blueprint: {
    identity_mode: 'none',
    contains_student_data: false,
    storage_visibility: 'teacher_private',
  },
  classroom_archive: {
    identity_mode: 'original_restricted',
    contains_student_data: true,
    storage_visibility: 'teacher_private',
  },
  gradex_extract: {
    identity_mode: 'per_extract_pseudonym',
    contains_student_data: true,
    direct_identifiers_allowed: false,
    raw_storage_objects_allowed: false,
    storage_visibility: 'service_private',
  },
} as const

export const GRADEX_DEIDENTIFICATION_CONTRACT = {
  identifier_fields: 'hmac_sha256_per_extract',
  identifier_scope: 'single_extract',
  database_identifier_fields: 'replace_id_and_id_suffix_fields_with_scoped_ref_fields',
  forbidden_output_fields: [
    'id',
    'email',
    'first_name',
    'last_name',
    'student_number',
    'teacher_id',
    'student_id',
    'user_id',
    'created_by',
    'updated_by',
    'triggered_by',
    'graded_by',
    'returned_by',
    'url',
    'storage_path',
    'snapshot_path',
    'repo_url',
    'selected_repo_url',
    'repo_owner',
    'repo_name',
    'github_login',
    'github_username',
  ],
  free_text: 'excluded_until_independent_dlp',
  timestamps: 'relative_offsets_only',
  external_references: 'exclude',
  release_gate: 'structured_only_zero_detected_direct_identifiers',
} as const
