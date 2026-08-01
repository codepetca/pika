import { describe, expect, it, vi } from 'vitest'
import { resumeLegacyBlueprintClassroomStorageReconciliation } from '@/lib/server/managed-storage-blueprint-reconciliation'

const teacherId = '10000000-0000-4000-8000-000000000001'
const blueprintId = '20000000-0000-4000-8000-000000000002'
const classroomId = '30000000-0000-4000-8000-000000000003'
const reconciliationId = '40000000-0000-4000-8000-000000000004'
const sourceObjectId = '50000000-0000-4000-8000-000000000005'
const targetObjectId = '60000000-0000-4000-8000-000000000006'
const sourcePath = 'legacy/original.pdf'
const targetPath = 'classrooms/copied.pdf'
const sourceBytes = new TextEncoder().encode('original Blueprint bytes')

const plan = {
  reconciliationId, sourceObjectId, targetObjectId, teacherId, blueprintId, classroomId,
  sourcePath, targetPath,
  classroomDocuments: [{
    testId: '70000000-0000-4000-8000-000000000007',
    documentId: 'doc',
    expectedReference: 'https://project.test/original.pdf',
  }],
  mutableBlueprintDocuments: [],
  immutableBlueprintEvidence: [{
    versionId: '80000000-0000-4000-8000-000000000008',
    expectedReference: 'https://project.test/original.pdf',
  }],
}

function createClient(options: {
  targetBytes?: Uint8Array | null
  cleanupReservationResult?: boolean
  cleanupCompletionResult?: boolean
  cleanupClaimFirst?: boolean
  removeError?: unknown
  replacementWinsBeforeCleanupReservation?: boolean
} = {}) {
  let targetBytes = options.targetBytes ?? null
  let copied = false
  let cleanupClaimed = false
  const reconciliation = {
    id: reconciliationId,
    teacher_id: teacherId,
    source_storage_bucket: 'test-documents',
    source_storage_path: sourcePath,
    target_storage_bucket: 'test-documents',
    target_storage_path: targetPath,
    status: 'planned',
    content_type: 'application/pdf',
    expected_byte_size: null,
    expected_sha256: null,
    last_error_code: null,
  }
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'plan_legacy_blueprint_classroom_storage_reconciliation') {
      return { data: reconciliation, error: null }
    }
    if (name === 'adopt_legacy_blueprint_classroom_storage_reconciliation') {
      return { data: copied ? { ok: true } : { ok: false }, error: null }
    }
    if (name === 'claim_legacy_blueprint_classroom_storage_reconciliation') {
      if (options.cleanupClaimFirst && !cleanupClaimed) {
        cleanupClaimed = true
        return {
          data: {
            ...reconciliation,
            status: 'copying',
            last_error_code: 'legacy_blueprint_reconciliation_cleanup_processing',
          },
          error: null,
        }
      }
      return {
        data: copied ? null : { ...reconciliation, status: 'copying' },
        error: null,
      }
    }
    if (name === 'complete_legacy_blueprint_classroom_storage_reconciliation') {
      copied = true
      return { data: true, error: null }
    }
    if (name === 'fail_legacy_blueprint_classroom_storage_reconciliation') {
      if (args?.p_error_code === 'legacy_blueprint_reconciliation_cleanup_started') {
        if (options.replacementWinsBeforeCleanupReservation) {
          targetBytes = new Uint8Array(sourceBytes)
          copied = true
          return { data: false, error: null }
        }
        return { data: options.cleanupReservationResult ?? true, error: null }
      }
      if (args?.p_error_code === 'legacy_blueprint_reconciliation_target_removed') {
        return { data: options.cleanupCompletionResult ?? true, error: null }
      }
      return { data: true, error: null }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const upload = vi.fn(async (_path: string, body: Uint8Array) => {
    if (targetBytes !== null) return { error: { message: 'already exists' } }
    targetBytes = new Uint8Array(body)
    return { error: null }
  })
  const remove = vi.fn(async () => {
    if (options.removeError) return { error: options.removeError }
    targetBytes = null
    return { error: null }
  })
  const client = {
    rpc,
    storage: {
      from: () => ({
        async download(path: string) {
          if (path === sourcePath) return { data: new Blob([sourceBytes]), error: null }
          return targetBytes
            ? { data: new Blob([targetBytes]), error: null }
            : { data: null, error: { message: 'not found' } }
        },
        upload,
        remove,
        getPublicUrl: () => ({ data: { publicUrl: 'https://project.test/copied.pdf' } }),
      }),
    },
  }
  return { client, rpc, upload, remove, getTargetBytes: () => targetBytes }
}

describe('legacy Blueprint/Classroom storage reconciliation', () => {
  it('copies with read-back verification before atomically adopting ownership', async () => {
    const { client, rpc, upload } = createClient()

    await resumeLegacyBlueprintClassroomStorageReconciliation({ plan, supabase: client })

    expect(upload).toHaveBeenCalledWith(targetPath, sourceBytes, {
      contentType: 'application/pdf', upsert: false,
    })
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'plan_legacy_blueprint_classroom_storage_reconciliation',
      'adopt_legacy_blueprint_classroom_storage_reconciliation',
      'claim_legacy_blueprint_classroom_storage_reconciliation',
      'complete_legacy_blueprint_classroom_storage_reconciliation',
      'adopt_legacy_blueprint_classroom_storage_reconciliation',
    ])
  })

  it('reserves cleanup before removing a mismatch, then retries and adopts', async () => {
    const { client, rpc, upload, remove } = createClient({
      targetBytes: new TextEncoder().encode('wrong bytes'),
    })

    await resumeLegacyBlueprintClassroomStorageReconciliation({ plan, supabase: client })

    const reservationIndex = rpc.mock.calls.findIndex(([, args]) => (
      args as Record<string, unknown> | undefined
    )?.p_error_code === 'legacy_blueprint_reconciliation_cleanup_started')
    expect(reservationIndex).toBeGreaterThanOrEqual(0)
    expect(rpc.mock.invocationCallOrder[reservationIndex]).toBeLessThan(
      remove.mock.invocationCallOrder[0],
    )
    expect(remove).toHaveBeenCalledWith([targetPath])
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('does not remove a mismatch after losing the copy lease before cleanup reservation', async () => {
    const { client, remove } = createClient({
      targetBytes: new TextEncoder().encode('wrong bytes'),
      cleanupReservationResult: false,
    })

    await expect(resumeLegacyBlueprintClassroomStorageReconciliation({
      plan,
      supabase: client,
    })).rejects.toMatchObject({
      code: 'legacy_blueprint_reconciliation_cleanup_lease_lost',
      retryable: true,
    })
    expect(remove).not.toHaveBeenCalled()
  })

  it('cannot remove a replacement worker target after its stale lease expires', async () => {
    const { client, remove, getTargetBytes } = createClient({
      targetBytes: new TextEncoder().encode('wrong bytes'),
      replacementWinsBeforeCleanupReservation: true,
    })

    await expect(resumeLegacyBlueprintClassroomStorageReconciliation({
      plan,
      supabase: client,
    })).rejects.toMatchObject({
      code: 'legacy_blueprint_reconciliation_cleanup_lease_lost',
    })

    expect(remove).not.toHaveBeenCalled()
    expect(getTargetBytes()).toEqual(sourceBytes)
  })

  it('keeps cleanup retryable when Storage removal fails', async () => {
    const { client, rpc } = createClient({
      targetBytes: new TextEncoder().encode('wrong bytes'),
      removeError: { statusCode: 503 },
    })

    await expect(resumeLegacyBlueprintClassroomStorageReconciliation({
      plan,
      supabase: client,
    })).rejects.toMatchObject({
      code: 'legacy_blueprint_reconciliation_mismatch_cleanup_failed',
      retryable: true,
    })
    expect(rpc).toHaveBeenCalledWith(
      'fail_legacy_blueprint_classroom_storage_reconciliation',
      expect.objectContaining({
        p_error_code: 'legacy_blueprint_reconciliation_mismatch_cleanup_failed',
      }),
    )
  })

  it('reclaims an expired cleanup lease without uploading before exact absence', async () => {
    const { client, upload, remove } = createClient({
      targetBytes: new TextEncoder().encode('wrong bytes'),
      cleanupClaimFirst: true,
    })

    await resumeLegacyBlueprintClassroomStorageReconciliation({ plan, supabase: client })

    expect(remove).toHaveBeenCalledWith([targetPath])
    expect(upload).toHaveBeenCalledTimes(1)
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(upload.mock.invocationCallOrder[0])
  })
})
