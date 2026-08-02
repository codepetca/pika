import { createHash } from 'node:crypto'
import { z } from 'zod'
import { discoverClassroomStorageReferences } from '@/lib/server/classroom-archive-format'
import { managedStorageObjectSchema } from '@/lib/server/managed-storage'

type BackfillClient = {
  from(table: string): any
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
}

const managedStorageInventoryEvidenceSchema = z.object({
  reference_count: z.number().int().nonnegative(),
  inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export type ManagedStorageBackfillCandidate = {
  bucket: 'assignment-artifacts' | 'submission-images' | 'test-documents'
  path: string
  purpose: 'student_assignment_artifact' | 'student_inline_image'
    | 'teacher_test_material' | 'test_execution_snapshot' | 'legacy_classroom_file'
  dataSubjectUserId?: string | null
  resourceType?: string | null
  resourceId?: string | null
  testDocument?: {
    testId: string
    documentId: string
    referenceKind: 'teacher_upload' | 'execution_snapshot'
    expectedReference: string
  }
}

export type ManagedStorageBlueprintReference = {
  bucket: 'test-documents'
  path: string
  blueprintId: string
  teacherId: string
  source: 'mutable_assessment' | 'immutable_version'
  assessmentId: string
  documentId: string
  managedObjectId: string | null
  versionId: string | null
  /** Exact current JSON value; only mutable documents are rewrite targets. */
  expectedReference: string
}

export class ManagedStorageBackfillError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'ManagedStorageBackfillError'
  }
}

function storageReferenceLabel(bucket: string, path: string): string {
  const fingerprint = createHash('sha256').update(path, 'utf8').digest('hex')
  return `${bucket} path_sha256=${fingerprint}`
}

function deterministicObjectId(classroomId: string, bucket: string, path: string): string {
  const bytes = createHash('sha256')
    .update(`${classroomId}\0${bucket}\0${path}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function managedUrlReference(
  value: unknown,
  supabaseUrl: string,
): { bucket: ManagedStorageBackfillCandidate['bucket']; path: string } | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.origin !== new URL(supabaseUrl).origin) return null
    const match = url.pathname.match(
      /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/,
    )
    if (!match) return null
    const bucket = decodeURIComponent(match[1]) as ManagedStorageBackfillCandidate['bucket']
    if (!['assignment-artifacts', 'submission-images', 'test-documents'].includes(bucket)) {
      return null
    }
    const path = decodeURIComponent(match[2])
    if (!path || path.startsWith('/') || path.split('/').some((part) => ['.', '..'].includes(part))) {
      return null
    }
    return { bucket, path }
  } catch {
    return null
  }
}

function collectTestDocumentReferences(input: {
  documents: unknown
  supabaseUrl: string
  add: (document: Record<string, unknown>) => void
}) {
  if (!Array.isArray(input.documents)) return
  for (const rawDocument of input.documents) {
    if (!rawDocument || typeof rawDocument !== 'object') continue
    const document = rawDocument as Record<string, unknown>
    if (document.source !== 'upload') continue
    const reference = managedUrlReference(document.url, input.supabaseUrl)
    if (reference?.bucket === 'test-documents') input.add(document)
  }
}

/**
 * Discovers only exact uploaded-test-document URLs. Version snapshots are read
 * as evidence, never as a rewrite target: their documents must remain byte-for-byte
 * immutable even when a mutable Blueprint needs a copied replacement.
 */
export function collectManagedStorageBlueprintReferences(input: {
  supabaseUrl: string
  assessments: Array<{
    id: string
    course_blueprint_id: string
    documents: unknown
  }>
  blueprints: Array<{ id: string; teacher_id: string }>
  versions: Array<{
    id: string
    course_blueprint_id: string
    snapshot_json: unknown
  }>
}): ManagedStorageBlueprintReference[] {
  const teacherByBlueprint = new Map(input.blueprints.map((blueprint) => [
    blueprint.id,
    blueprint.teacher_id,
  ]))
  const references: ManagedStorageBlueprintReference[] = []
  const add = (
    value: Omit<ManagedStorageBlueprintReference,
      'bucket' | 'path' | 'managedObjectId' | 'expectedReference'>,
    document: Record<string, unknown>,
  ) => {
    const reference = managedUrlReference(document.url, input.supabaseUrl)
    if (reference?.bucket !== 'test-documents') return
    references.push({
      ...value,
      bucket: reference.bucket,
      path: reference.path,
      managedObjectId: typeof document.managed_object_id === 'string'
        && document.managed_object_id.trim()
        ? document.managed_object_id.trim()
        : null,
      expectedReference: String(document.url),
    })
  }

  for (const assessment of input.assessments) {
    const teacherId = teacherByBlueprint.get(assessment.course_blueprint_id)
    if (!teacherId) continue
    collectTestDocumentReferences({
      documents: assessment.documents,
      supabaseUrl: input.supabaseUrl,
      add: (document) => add({
        blueprintId: assessment.course_blueprint_id,
        teacherId,
        source: 'mutable_assessment',
        assessmentId: assessment.id,
        documentId: typeof document.id === 'string' ? document.id : '',
        versionId: null,
      }, document),
    })
  }

  for (const version of input.versions) {
    const teacherId = teacherByBlueprint.get(version.course_blueprint_id)
    if (!teacherId || !version.snapshot_json || typeof version.snapshot_json !== 'object') continue
    const assessments = (version.snapshot_json as Record<string, unknown>).assessments
    if (!Array.isArray(assessments)) continue
    for (const rawAssessment of assessments) {
      if (!rawAssessment || typeof rawAssessment !== 'object') continue
      const assessment = rawAssessment as Record<string, unknown>
      collectTestDocumentReferences({
        documents: assessment.documents,
        supabaseUrl: input.supabaseUrl,
        add: (document) => add({
          blueprintId: version.course_blueprint_id,
          teacherId,
          source: 'immutable_version',
          assessmentId: typeof assessment.id === 'string'
            ? assessment.id
            : typeof assessment.artifact_id === 'string' ? assessment.artifact_id : '',
          documentId: typeof document.id === 'string' ? document.id : '',
          versionId: version.id,
        }, document),
      })
    }
  }

  return references.sort((left, right) => (
    left.bucket.localeCompare(right.bucket)
    || left.path.localeCompare(right.path)
    || left.blueprintId.localeCompare(right.blueprintId)
    || left.source.localeCompare(right.source)
    || (left.versionId || '').localeCompare(right.versionId || '')
    || left.assessmentId.localeCompare(right.assessmentId)
    || left.documentId.localeCompare(right.documentId)
  ))
}

export function collectManagedStorageBackfillCandidates(input: {
  resources: Record<string, Array<Record<string, unknown>>>
  supabaseUrl: string
}): ManagedStorageBackfillCandidate[] {
  const candidates = new Map<string, ManagedStorageBackfillCandidate>()
  const add = (candidate: ManagedStorageBackfillCandidate) => {
    const key = `${candidate.bucket}\0${candidate.path}`
    const current = candidates.get(key)
    if (
      current
      && (
        current.purpose !== candidate.purpose
        || current.resourceId !== candidate.resourceId
        || current.testDocument?.documentId !== candidate.testDocument?.documentId
      )
    ) {
      throw new ManagedStorageBackfillError(
        'legacy_storage_reference_ambiguous',
        `Legacy file has conflicting classroom references: ${storageReferenceLabel(
          candidate.bucket,
          candidate.path,
        )}`,
      )
    }
    candidates.set(key, current || candidate)
  }

  for (const artifact of input.resources.assignment_submission_artifacts || []) {
    if (typeof artifact.storage_path !== 'string') continue
    add({
      bucket: 'assignment-artifacts',
      path: artifact.storage_path,
      purpose: 'student_assignment_artifact',
      dataSubjectUserId: typeof artifact.student_id === 'string' ? artifact.student_id : null,
      resourceType: 'assignment_doc',
      resourceId: typeof artifact.assignment_doc_id === 'string'
        ? artifact.assignment_doc_id
        : null,
    })
  }

  for (const test of input.resources.tests || []) {
    if (typeof test.id !== 'string' || !Array.isArray(test.documents)) continue
    for (const rawDocument of test.documents) {
      if (!rawDocument || typeof rawDocument !== 'object') continue
      const document = rawDocument as Record<string, unknown>
      if (typeof document.id !== 'string') continue
      if (document.source === 'upload') {
        const reference = managedUrlReference(document.url, input.supabaseUrl)
        if (reference?.bucket === 'test-documents') {
          add({
            ...reference,
            purpose: 'teacher_test_material',
            resourceType: 'test',
            resourceId: test.id,
            testDocument: {
              testId: test.id,
              documentId: document.id,
              referenceKind: 'teacher_upload',
              expectedReference: String(document.url),
            },
          })
        }
      }
      if (typeof document.snapshot_path === 'string' && document.snapshot_path) {
        add({
          bucket: 'test-documents',
          path: document.snapshot_path,
          purpose: 'test_execution_snapshot',
          resourceType: 'test',
          resourceId: test.id,
          testDocument: {
            testId: test.id,
            documentId: document.id,
            referenceKind: 'execution_snapshot',
            expectedReference: document.snapshot_path,
          },
        })
      }
    }
  }

  for (const reference of discoverClassroomStorageReferences(
    input.resources,
    input.supabaseUrl,
  )) {
    const key = `${reference.bucket}\0${reference.path}`
    if (candidates.has(key)) continue
    add({
      ...reference,
      purpose: reference.bucket === 'submission-images'
        ? 'student_inline_image'
        : 'legacy_classroom_file',
    })
  }
  return [...candidates.values()].sort((left, right) => (
    left.bucket.localeCompare(right.bucket) || left.path.localeCompare(right.path)
  ))
}

async function readRevision(supabase: BackfillClient, classroomId: string): Promise<number> {
  const { data, error } = await supabase
    .from('classroom_archive_revisions')
    .select('revision')
    .eq('classroom_id', classroomId)
    .single()
  if (error) {
    throw new ManagedStorageBackfillError(
      error.code || 'legacy_storage_revision_read_failed',
      error.message || 'Could not read classroom revision',
    )
  }
  return z.coerce.number().int().positive().parse(data?.revision)
}

async function backfillClassroomManagedStorage(input: {
  supabase: BackfillClient
  teacherId: string
  classroomId: string
  expectedSourceRevision: number
  supabaseUrl: string
  resources: Record<string, Array<Record<string, unknown>>>
}) {
  const revisionBefore = await readRevision(input.supabase, input.classroomId)
  if (revisionBefore !== input.expectedSourceRevision) {
    throw new ManagedStorageBackfillError(
      'legacy_storage_revision_drift',
      'Classroom changed after its legacy file ownership was inventoried',
    )
  }
  const candidates = collectManagedStorageBackfillCandidates(input)

  for (const candidate of candidates) {
    const { data, error } = await input.supabase.rpc(
      'register_legacy_classroom_storage_object',
      {
        p_object_id: deterministicObjectId(
          input.classroomId,
          candidate.bucket,
          candidate.path,
        ),
        p_teacher_id: input.teacherId,
        p_classroom_id: input.classroomId,
        p_storage_bucket: candidate.bucket,
        p_storage_path: candidate.path,
        p_purpose: candidate.purpose,
        p_created_by_user_id: input.teacherId,
        p_data_subject_user_id: candidate.dataSubjectUserId ?? null,
        p_resource_type: candidate.resourceType ?? null,
        p_resource_id: candidate.resourceId ?? null,
        p_content_type: null,
        p_byte_size: null,
      },
    )
    if (error) {
      throw new ManagedStorageBackfillError(
        error.code || 'legacy_storage_registration_failed',
        error.message || 'Legacy classroom file could not be registered',
      )
    }
    const object = managedStorageObjectSchema.parse(data)

    if (candidate.testDocument) {
      const attachment = await input.supabase.rpc(
        'attach_legacy_test_document_managed_object',
        {
          p_teacher_id: input.teacherId,
          p_classroom_id: input.classroomId,
          p_test_id: candidate.testDocument.testId,
          p_document_id: candidate.testDocument.documentId,
          p_reference_kind: candidate.testDocument.referenceKind,
          p_expected_reference: candidate.testDocument.expectedReference,
          p_managed_object_id: object.id,
        },
      )
      if (attachment.error || attachment.data !== true) {
        throw new ManagedStorageBackfillError(
          attachment.error?.code || 'legacy_test_document_attachment_failed',
          attachment.error?.message || 'Legacy Test document ownership could not be attached',
        )
      }
    }
  }

  const revisionAfter = await readRevision(input.supabase, input.classroomId)
  if (
    revisionAfter !== revisionBefore
    || revisionAfter !== input.expectedSourceRevision
  ) {
    throw new ManagedStorageBackfillError(
      'legacy_storage_revision_drift',
      'Classroom changed while its legacy file ownership was being inventoried',
    )
  }
  // Migration 117 may already own operational objects that do not appear in
  // the relational archive graph (archives, Gradex extracts, or interrupted
  // cleanup). Ask the database for the canonical complete inventory after all
  // legacy references have been adopted, then bind verification to that exact
  // evidence. The verification RPC recomputes it under the classroom lock.
  const evidenceResult = await input.supabase.rpc(
    'read_classroom_managed_storage_inventory_evidence',
    {
      p_teacher_id: input.teacherId,
      p_classroom_id: input.classroomId,
    },
  )
  if (evidenceResult.error) {
    throw new ManagedStorageBackfillError(
      evidenceResult.error.code || 'legacy_storage_inventory_read_failed',
      evidenceResult.error.message || 'Managed classroom inventory could not be read',
    )
  }
  const evidence = managedStorageInventoryEvidenceSchema.parse(evidenceResult.data)
  const verification = await input.supabase.rpc(
    'verify_classroom_managed_storage_coverage',
    {
      p_teacher_id: input.teacherId,
      p_classroom_id: input.classroomId,
      p_source_revision: revisionAfter,
      p_reference_count: evidence.reference_count,
      p_inventory_sha256: evidence.inventory_sha256,
    },
  )
  if (verification.error) {
    throw new ManagedStorageBackfillError(
      verification.error.code || 'legacy_storage_coverage_failed',
      verification.error.message || 'Legacy classroom file coverage could not be verified',
    )
  }
  return {
    classroomId: input.classroomId,
    sourceRevision: revisionAfter,
    objectCount: evidence.reference_count,
    inventorySha256: evidence.inventory_sha256,
  }
}

export async function backfillAllClassroomManagedStorage(input: {
  inventoryScope: 'all_classrooms'
  supabase: BackfillClient
  supabaseUrl: string
  classrooms: Array<{
    teacherId: string
    classroomId: string
    expectedSourceRevision: number
    resources: Record<string, Array<Record<string, unknown>>>
  }>
}) {
  const ownerByReference = new Map<string, string>()
  for (const classroom of input.classrooms) {
    for (const candidate of collectManagedStorageBackfillCandidates({
      resources: classroom.resources,
      supabaseUrl: input.supabaseUrl,
    })) {
      const reference = `${candidate.bucket}\0${candidate.path}`
      const currentOwner = ownerByReference.get(reference)
      if (currentOwner && currentOwner !== classroom.classroomId) {
        throw new ManagedStorageBackfillError(
          'legacy_storage_reference_shared',
          `Legacy file is referenced by multiple classrooms: ${storageReferenceLabel(
            candidate.bucket,
            candidate.path,
          )}`,
        )
      }
      ownerByReference.set(reference, classroom.classroomId)
    }
  }

  // Validate the complete all-class snapshot before the first ownership write.
  // A rerun is safe because registrations are deterministic and same-owner
  // idempotent, but a known-stale snapshot must never begin writing.
  for (const classroom of input.classrooms) {
    const currentRevision = await readRevision(input.supabase, classroom.classroomId)
    if (currentRevision !== classroom.expectedSourceRevision) {
      throw new ManagedStorageBackfillError(
        'legacy_storage_revision_drift',
        'Classroom changed after the all-class legacy storage inventory',
      )
    }
  }

  const results = []
  for (const classroom of input.classrooms) {
    results.push(await backfillClassroomManagedStorage({
      supabase: input.supabase,
      supabaseUrl: input.supabaseUrl,
      teacherId: classroom.teacherId,
      classroomId: classroom.classroomId,
      expectedSourceRevision: classroom.expectedSourceRevision,
      resources: classroom.resources,
    }))
  }
  return results
}
