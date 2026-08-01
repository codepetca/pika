import { describe, expect, it, vi } from 'vitest'
import { resumeLegacyBlueprintClassroomStorageReconciliation } from '@/lib/server/managed-storage-blueprint-reconciliation'

const teacherId = '10000000-0000-4000-8000-000000000001'
const blueprintId = '20000000-0000-4000-8000-000000000002'
const classroomId = '30000000-0000-4000-8000-000000000003'
const reconciliationId = '40000000-0000-4000-8000-000000000004'
const sourceObjectId = '50000000-0000-4000-8000-000000000005'
const targetObjectId = '60000000-0000-4000-8000-000000000006'
const sourcePath = 'legacy/original.pdf'
const targetPath = `classrooms/${classroomId}/tests/legacy-blueprint-reconciliation/${targetObjectId}.pdf`
const sourceBytes = new TextEncoder().encode('original Blueprint bytes')

const plan = {
  reconciliationId, sourceObjectId, targetObjectId, teacherId, blueprintId, classroomId,
  sourcePath,
  classroomDocuments: [{
    testId: '70000000-0000-4000-8000-000000000007',
    documentId: 'doc', expectedReference: 'https://project.test/original.pdf',
  }],
  mutableBlueprintDocuments: [],
  immutableBlueprintEvidence: [{
    versionId: '80000000-0000-4000-8000-000000000008',
    expectedReference: 'https://project.test/original.pdf',
  }],
}

function createClient(options: {
  targetBytes?: Uint8Array
  rotationResult?: boolean
  sourceChangesAfterCopy?: boolean
  plannedStatus?: 'planned' | 'adopted' | 'blocked'
} = {}) {
  const stored = new Map<string, Uint8Array>()
  if (options.targetBytes) stored.set(targetPath, options.targetBytes)
  let copied = false
  let currentSourceBytes = sourceBytes
  let reconciliation = {
    id: reconciliationId,
    teacher_id: teacherId,
    source_storage_bucket: 'test-documents',
    source_storage_path: sourcePath,
    target_storage_bucket: 'test-documents',
    target_storage_path: targetPath,
    status: options.plannedStatus ?? 'planned',
    content_type: 'application/pdf',
    expected_byte_size: null,
    expected_sha256: null,
  }
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'plan_legacy_blueprint_classroom_storage_reconciliation') {
      return { data: reconciliation, error: null }
    }
    if (name === 'adopt_legacy_blueprint_classroom_storage_reconciliation') {
      return { data: copied ? { ok: true } : { ok: false }, error: null }
    }
    if (name === 'claim_legacy_blueprint_classroom_storage_reconciliation') {
      return { data: copied ? null : { ...reconciliation, status: 'copying' }, error: null }
    }
    if (name === 'rotate_legacy_blueprint_classroom_storage_reconciliation_target') {
      if (options.rotationResult === false) return { data: false, error: null }
      const nextId = String(args?.p_target_object_id)
      reconciliation = {
        ...reconciliation,
        status: 'failed',
        target_storage_path: `classrooms/${classroomId}/tests/legacy-blueprint-reconciliation/${nextId}.pdf`,
      }
      return { data: true, error: null }
    }
    if (name === 'complete_legacy_blueprint_classroom_storage_reconciliation') {
      copied = true
      if (options.sourceChangesAfterCopy) {
        currentSourceBytes = new TextEncoder().encode('changed source bytes')
      }
      return { data: true, error: null }
    }
    if (name === 'fail_legacy_blueprint_classroom_storage_reconciliation') {
      return { data: true, error: null }
    }
    if (name === 'block_copied_legacy_blueprint_storage_reconciliation') {
      reconciliation = { ...reconciliation, status: 'blocked' }
      return { data: true, error: null }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const upload = vi.fn(async (path: string, body: Uint8Array) => {
    if (stored.has(path)) return { error: { message: 'already exists' } }
    stored.set(path, new Uint8Array(body))
    return { error: null }
  })
  const client = {
    rpc,
    storage: {
      from: () => ({
        async download(path: string) {
          if (path === sourcePath) return { data: new Blob([currentSourceBytes]), error: null }
          const bytes = stored.get(path)
          return bytes
            ? { data: new Blob([bytes]), error: null }
            : { data: null, error: { message: 'not found' } }
        },
        upload,
        getPublicUrl: () => ({ data: { publicUrl: 'https://project.test/copied.pdf' } }),
      }),
    },
  }
  return {
    client, rpc, upload, stored,
    currentPath: () => reconciliation.target_storage_path,
  }
}

describe('legacy Blueprint/Classroom storage reconciliation', () => {
  it('treats a durable adopted receipt as complete without another Storage write', async () => {
    const { client, rpc, upload } = createClient({ plannedStatus: 'adopted' })

    await resumeLegacyBlueprintClassroomStorageReconciliation({ plan, supabase: client })

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'plan_legacy_blueprint_classroom_storage_reconciliation',
    ])
    expect(upload).not.toHaveBeenCalled()
  })

  it('keeps a blocked generation terminal without retrying or touching Storage', async () => {
    const { client, rpc, upload } = createClient({ plannedStatus: 'blocked' })

    await expect(resumeLegacyBlueprintClassroomStorageReconciliation({
      plan, supabase: client,
    })).rejects.toMatchObject({
      code: 'legacy_blueprint_reconciliation_operator_recovery_required',
      retryable: false,
    })
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'plan_legacy_blueprint_classroom_storage_reconciliation',
    ])
    expect(upload).not.toHaveBeenCalled()
  })

  it('copies with read-back verification before atomically adopting ownership', async () => {
    const { client, rpc, upload } = createClient()

    await resumeLegacyBlueprintClassroomStorageReconciliation({ plan, supabase: client })

    expect(upload).toHaveBeenCalledWith(targetPath, sourceBytes, {
      contentType: 'application/pdf', upsert: false,
    })
    expect(rpc).toHaveBeenCalledWith(
      'plan_legacy_blueprint_classroom_storage_reconciliation',
      expect.not.objectContaining({
        p_target_storage_bucket: expect.anything(),
        p_target_storage_path: expect.anything(),
      }),
    )
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'plan_legacy_blueprint_classroom_storage_reconciliation',
      'adopt_legacy_blueprint_classroom_storage_reconciliation',
      'claim_legacy_blueprint_classroom_storage_reconciliation',
      'complete_legacy_blueprint_classroom_storage_reconciliation',
      'adopt_legacy_blueprint_classroom_storage_reconciliation',
    ])
  })

  it('abandons a mismatched generation and adopts a new owned path without deleting the old key', async () => {
    const wrongBytes = new TextEncoder().encode('wrong bytes')
    const { client, rpc, upload, stored, currentPath } = createClient({ targetBytes: wrongBytes })

    await resumeLegacyBlueprintClassroomStorageReconciliation({ plan, supabase: client })

    expect(rpc).toHaveBeenCalledWith(
      'rotate_legacy_blueprint_classroom_storage_reconciliation_target',
      expect.objectContaining({ p_reconciliation_id: reconciliationId, p_teacher_id: teacherId }),
    )
    expect(currentPath()).not.toBe(targetPath)
    expect(stored.get(targetPath)).toEqual(wrongBytes)
    expect(stored.get(currentPath())).toEqual(sourceBytes)
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('leaves the existing generation untouched when rotation loses its lease', async () => {
    const wrongBytes = new TextEncoder().encode('wrong bytes')
    const { client, stored, currentPath } = createClient({
      targetBytes: wrongBytes,
      rotationResult: false,
    })

    await expect(resumeLegacyBlueprintClassroomStorageReconciliation({
      plan, supabase: client,
    })).rejects.toMatchObject({
      code: 'legacy_blueprint_reconciliation_generation_lease_lost',
      retryable: true,
    })
    expect(currentPath()).toBe(targetPath)
    expect(stored.get(targetPath)).toEqual(wrongBytes)
  })

  it('durably blocks adoption when the legacy source changes after verified copy', async () => {
    const { client, rpc } = createClient({ sourceChangesAfterCopy: true })

    await expect(resumeLegacyBlueprintClassroomStorageReconciliation({
      plan, supabase: client,
    })).rejects.toMatchObject({
      code: 'legacy_blueprint_reconciliation_source_changed',
      retryable: false,
    })
    expect(rpc).toHaveBeenCalledWith(
      'block_copied_legacy_blueprint_storage_reconciliation',
      {
        p_reconciliation_id: reconciliationId,
        p_teacher_id: teacherId,
        p_error_code: 'legacy_blueprint_reconciliation_source_changed',
      },
    )
    expect(rpc.mock.calls.filter(([name]) => (
      name === 'adopt_legacy_blueprint_classroom_storage_reconciliation'
    ))).toHaveLength(1)
  })
})
