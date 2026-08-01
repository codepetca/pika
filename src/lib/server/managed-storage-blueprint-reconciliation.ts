import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'

const reconciliationSchema = z.object({
  id: z.string().uuid(),
  teacher_id: z.string().uuid(),
  source_storage_bucket: z.literal('test-documents'),
  source_storage_path: z.string().min(1),
  target_storage_bucket: z.literal('test-documents'),
  target_storage_path: z.string().min(1),
  status: z.enum(['planned', 'copying', 'copied', 'adopted', 'failed', 'blocked']),
  content_type: z.string().nullable(),
  expected_byte_size: z.coerce.number().int().nonnegative().nullable(),
  expected_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  last_error_code: z.string().nullable().optional(),
}).passthrough()

type Reconciliation = z.infer<typeof reconciliationSchema>

type StorageBucket = {
  download(path: string): Promise<{ data: Blob | null; error: { message?: string } | null }>
  upload(path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }): Promise<{
    error: { message?: string } | null
  }>
  getPublicUrl(path: string): { data: { publicUrl: string } }
}

type ReconciliationClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown; error: { code?: string; message?: string } | null
  }>
  storage: { from(bucket: string): StorageBucket }
}

export type LegacyBlueprintClassroomReconciliationPlan = {
  reconciliationId: string
  sourceObjectId: string
  targetObjectId: string
  teacherId: string
  blueprintId: string
  classroomId: string
  sourcePath: string
  classroomDocuments: Array<{ testId: string; documentId: string; expectedReference: string }>
  mutableBlueprintDocuments: Array<{
    assessmentId: string; documentId: string; expectedReference: string
  }>
  immutableBlueprintEvidence: Array<{ versionId: string; expectedReference: string }>
}

export class LegacyBlueprintClassroomReconciliationError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean, message: string) {
    super(message)
    this.name = 'LegacyBlueprintClassroomReconciliationError'
  }
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function failure(error: { code?: string; message?: string } | null, code: string) {
  return new LegacyBlueprintClassroomReconciliationError(
    error?.code || code, true, error?.message || 'Legacy Blueprint reconciliation can be resumed',
  )
}

async function adopt(supabase: ReconciliationClient, reconciliationId: string, teacherId: string) {
  const { data, error } = await supabase.rpc('adopt_legacy_blueprint_classroom_storage_reconciliation', {
    p_reconciliation_id: reconciliationId, p_teacher_id: teacherId,
  })
  if (error) throw failure(error, 'legacy_blueprint_reconciliation_adoption_failed')
  return z.object({
    ok: z.boolean(), error_code: z.string().optional(), retryable: z.boolean().optional(),
  }).parse(data)
}

async function blockCopiedReconciliation(
  supabase: ReconciliationClient,
  reconciliation: Reconciliation,
  error: LegacyBlueprintClassroomReconciliationError,
) {
  const blocked = await supabase.rpc(
    'block_copied_legacy_blueprint_storage_reconciliation',
    {
      p_reconciliation_id: reconciliation.id,
      p_teacher_id: reconciliation.teacher_id,
      p_error_code: error.code,
    },
  )
  if (blocked.error) throw failure(
    blocked.error, 'legacy_blueprint_reconciliation_block_failed',
  )
  if (blocked.data !== true) throw new LegacyBlueprintClassroomReconciliationError(
    'legacy_blueprint_reconciliation_block_race', true,
    'Legacy reconciliation changed before its terminal failure was recorded',
  )
}

async function verifySourceUnchanged(supabase: ReconciliationClient, reconciliation: Reconciliation) {
  if (reconciliation.expected_byte_size === null || reconciliation.expected_sha256 === null) return
  const source = await supabase.storage.from(reconciliation.source_storage_bucket)
    .download(reconciliation.source_storage_path)
  if (source.error || !source.data) throw new LegacyBlueprintClassroomReconciliationError(
    'legacy_blueprint_reconciliation_source_missing', true,
    source.error?.message || 'Shared test material is unavailable before ownership adoption',
  )
  const bytes = new Uint8Array(await source.data.arrayBuffer())
  if (bytes.byteLength !== reconciliation.expected_byte_size || sha256(bytes) !== reconciliation.expected_sha256) {
    throw new LegacyBlueprintClassroomReconciliationError(
      'legacy_blueprint_reconciliation_source_changed', false,
      'Shared test material changed after the verified copy completed',
    )
  }
}

async function copy(input: { supabase: ReconciliationClient; reconciliation: Reconciliation; leaseToken: string }) {
  const { supabase, reconciliation, leaseToken } = input
  try {
    const target = supabase.storage.from(reconciliation.target_storage_bucket)
    const source = await supabase.storage.from(reconciliation.source_storage_bucket)
      .download(reconciliation.source_storage_path)
    if (source.error || !source.data) throw new LegacyBlueprintClassroomReconciliationError(
      'legacy_blueprint_reconciliation_source_missing', true,
      source.error?.message || 'Shared test material is unavailable',
    )
    const bytes = new Uint8Array(await source.data.arrayBuffer())
    const digest = sha256(bytes)
    if ((reconciliation.expected_byte_size !== null && reconciliation.expected_byte_size !== bytes.byteLength)
      || (reconciliation.expected_sha256 !== null && reconciliation.expected_sha256 !== digest)) {
      throw new LegacyBlueprintClassroomReconciliationError(
        'legacy_blueprint_reconciliation_source_changed', false,
        'Shared test material changed after reconciliation was planned',
      )
    }
    const uploaded = await target.upload(reconciliation.target_storage_path, bytes, {
      contentType: reconciliation.content_type || 'application/octet-stream', upsert: false,
    })
    if (uploaded.error) {
      const existing = await target.download(reconciliation.target_storage_path)
      if (existing.error || !existing.data) throw new LegacyBlueprintClassroomReconciliationError(
        'legacy_blueprint_reconciliation_upload_failed', true,
        uploaded.error.message || 'Shared test material copy failed',
      )
    }
    const verified = await target.download(reconciliation.target_storage_path)
    if (verified.error || !verified.data) throw new LegacyBlueprintClassroomReconciliationError(
      'legacy_blueprint_reconciliation_verification_failed', true,
      verified.error?.message || 'Copied test material could not be verified',
    )
    const copied = new Uint8Array(await verified.data.arrayBuffer())
    if (copied.byteLength !== bytes.byteLength || sha256(copied) !== digest) {
      const rotation = await supabase.rpc(
        'rotate_legacy_blueprint_classroom_storage_reconciliation_target',
        {
          p_reconciliation_id: reconciliation.id,
          p_teacher_id: reconciliation.teacher_id,
          p_lease_token: leaseToken,
          p_target_object_id: randomUUID(),
        },
      )
      if (rotation.error) throw failure(
        rotation.error, 'legacy_blueprint_reconciliation_generation_rotation_failed',
      )
      if (rotation.data !== true) throw new LegacyBlueprintClassroomReconciliationError(
        'legacy_blueprint_reconciliation_generation_lease_lost', true,
        'Legacy reconciliation lease expired before a replacement was reserved',
      )
      return null
    }
    const completion = await supabase.rpc('complete_legacy_blueprint_classroom_storage_reconciliation', {
      p_reconciliation_id: reconciliation.id,
      p_teacher_id: reconciliation.teacher_id,
      p_lease_token: leaseToken,
      p_target_public_url: target.getPublicUrl(reconciliation.target_storage_path).data.publicUrl,
      p_byte_size: copied.byteLength,
      p_content_sha256: digest,
    })
    if (completion.error || completion.data !== true) {
      throw failure(completion.error, 'legacy_blueprint_reconciliation_completion_failed')
    }
    return { byteSize: copied.byteLength, sha256: digest }
  } catch (error) {
    const copyError = error instanceof LegacyBlueprintClassroomReconciliationError
      ? error : new LegacyBlueprintClassroomReconciliationError(
        'legacy_blueprint_reconciliation_failed', true,
        error instanceof Error ? error.message : 'Shared test material copy failed',
      )
    const failed = await supabase.rpc('fail_legacy_blueprint_classroom_storage_reconciliation', {
      p_reconciliation_id: reconciliation.id, p_teacher_id: reconciliation.teacher_id,
      p_lease_token: leaseToken, p_error_code: copyError.code,
      p_retryable: copyError.retryable,
    })
    if (failed.error) throw failure(
      failed.error, 'legacy_blueprint_reconciliation_failure_record_failed',
    )
    if (failed.data !== true) throw new LegacyBlueprintClassroomReconciliationError(
      'legacy_blueprint_reconciliation_failure_record_race', true,
      'Legacy reconciliation changed before its failure was recorded',
    )
    throw copyError
  }
}

/** Plans deterministically, copies with read-back verification, then atomically adopts metadata. */
export async function resumeLegacyBlueprintClassroomStorageReconciliation(input: {
  plan: LegacyBlueprintClassroomReconciliationPlan
  supabase?: ReconciliationClient
}) {
  const supabase = input.supabase ?? (getServiceRoleClient() as unknown as ReconciliationClient)
  const { plan } = input
  const planned = await supabase.rpc('plan_legacy_blueprint_classroom_storage_reconciliation', {
    p_reconciliation_id: plan.reconciliationId, p_source_object_id: plan.sourceObjectId,
    p_target_object_id: plan.targetObjectId, p_teacher_id: plan.teacherId,
    p_blueprint_id: plan.blueprintId, p_classroom_id: plan.classroomId,
    p_source_storage_bucket: 'test-documents', p_source_storage_path: plan.sourcePath,
    p_classroom_documents: plan.classroomDocuments,
    p_mutable_blueprint_documents: plan.mutableBlueprintDocuments,
    p_immutable_blueprint_evidence: plan.immutableBlueprintEvidence,
  })
  if (planned.error) throw failure(planned.error, 'legacy_blueprint_reconciliation_plan_failed')
  let reconciliation = reconciliationSchema.parse(planned.data)
  if (reconciliation.status === 'adopted') return
  if (reconciliation.status === 'blocked') throw new LegacyBlueprintClassroomReconciliationError(
    reconciliation.last_error_code || 'legacy_blueprint_reconciliation_operator_recovery_required',
    false,
    'Shared test material requires verified operator recovery',
  )
  if (reconciliation.status === 'copied') {
    try {
      await verifySourceUnchanged(supabase, reconciliation)
    } catch (error) {
      if (!(error instanceof LegacyBlueprintClassroomReconciliationError) || error.retryable) throw error
      await blockCopiedReconciliation(supabase, reconciliation, error)
      throw error
    }
  }
  const beforeCopy = await adopt(supabase, reconciliation.id, reconciliation.teacher_id)
  if (beforeCopy.ok) return
  for (let attempts = 0; attempts < 5; attempts += 1) {
    const leaseToken = randomUUID()
    const claim = await supabase.rpc('claim_legacy_blueprint_classroom_storage_reconciliation', {
      p_reconciliation_id: reconciliation.id, p_teacher_id: reconciliation.teacher_id,
      p_lease_token: leaseToken, p_lease_seconds: 120,
    })
    if (claim.error) throw failure(claim.error, 'legacy_blueprint_reconciliation_claim_failed')
    const claimed = claim.data ? reconciliationSchema.parse(claim.data) : null
    if (!claimed) {
      const adopted = await adopt(supabase, reconciliation.id, reconciliation.teacher_id)
      if (adopted.ok) return
      throw new LegacyBlueprintClassroomReconciliationError(
        adopted.error_code || 'legacy_blueprint_reconciliation_incomplete',
        adopted.retryable ?? true,
        'Shared test material reconciliation is active and can be resumed',
      )
    }
    const completed = await copy({ supabase, reconciliation: claimed, leaseToken })
    if (!completed) {
      reconciliation = { ...claimed, status: 'failed', last_error_code: null }
      continue
    }
    reconciliation = {
      ...claimed,
      status: 'copied',
      expected_byte_size: completed.byteSize,
      expected_sha256: completed.sha256,
    }
    // Completion recorded the source digest. Re-read before changing the old
    // path's owner so Blueprint Versions continue to resolve the original bytes.
    try {
      await verifySourceUnchanged(supabase, reconciliation)
    } catch (error) {
      if (!(error instanceof LegacyBlueprintClassroomReconciliationError) || error.retryable) throw error
      await blockCopiedReconciliation(supabase, reconciliation, error)
      throw error
    }
    const adopted = await adopt(supabase, reconciliation.id, reconciliation.teacher_id)
    if (adopted.ok) return
  }
  throw new LegacyBlueprintClassroomReconciliationError(
    'legacy_blueprint_reconciliation_limit_exceeded', true,
    'Shared test material reconciliation paused and can be resumed',
  )
}
