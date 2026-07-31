import { describe, expect, it, vi } from 'vitest'
import { resumeLegacyBlueprintClassroomStorageReconciliation } from '@/lib/server/managed-storage-blueprint-reconciliation'

const teacherId = '10000000-0000-4000-8000-000000000001'
const blueprintId = '20000000-0000-4000-8000-000000000002'
const classroomId = '30000000-0000-4000-8000-000000000003'
const reconciliationId = '40000000-0000-4000-8000-000000000004'
const sourceObjectId = '50000000-0000-4000-8000-000000000005'
const targetObjectId = '60000000-0000-4000-8000-000000000006'

describe('legacy Blueprint/Classroom storage reconciliation', () => {
  it('copies with read-back verification before atomically adopting ownership', async () => {
    const bytes = new TextEncoder().encode('original Blueprint bytes')
    const uploaded = vi.fn(async () => ({ error: null }))
    const sourceBucket = { download: vi.fn(async () => ({ data: new Blob([bytes]), error: null })) }
    const targetBucket = {
      download: vi.fn(async () => ({ data: new Blob([bytes]), error: null })),
      upload: uploaded,
      getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://project.test/copied.pdf' } })),
    }
    const reconciliation = {
      id: reconciliationId, teacher_id: teacherId,
      source_storage_bucket: 'test-documents', source_storage_path: 'legacy/original.pdf',
      target_storage_bucket: 'test-documents', target_storage_path: 'classrooms/copied.pdf',
      status: 'planned', content_type: 'application/pdf', expected_byte_size: null, expected_sha256: null,
    }
    let adopted = 0
    const rpc = vi.fn(async (name: string) => {
      if (name === 'plan_legacy_blueprint_classroom_storage_reconciliation') {
        return { data: reconciliation, error: null }
      }
      if (name === 'adopt_legacy_blueprint_classroom_storage_reconciliation') {
        adopted += 1
        return { data: adopted === 1 ? { ok: false } : { ok: true }, error: null }
      }
      if (name === 'claim_legacy_blueprint_classroom_storage_reconciliation') {
        return { data: { ...reconciliation, status: 'copying' }, error: null }
      }
      if (name === 'complete_legacy_blueprint_classroom_storage_reconciliation') {
        return { data: true, error: null }
      }
      return { data: true, error: null }
    })

    await resumeLegacyBlueprintClassroomStorageReconciliation({
      plan: {
        reconciliationId, sourceObjectId, targetObjectId, teacherId, blueprintId, classroomId,
        sourcePath: 'legacy/original.pdf', targetPath: 'classrooms/copied.pdf',
        classroomDocuments: [{ testId: '70000000-0000-4000-8000-000000000007', documentId: 'doc', expectedReference: 'https://project.test/original.pdf' }],
        mutableBlueprintDocuments: [],
        immutableBlueprintEvidence: [{ versionId: '80000000-0000-4000-8000-000000000008', expectedReference: 'https://project.test/original.pdf' }],
      },
      supabase: {
        rpc,
        storage: { from: (bucket: string) => bucket === 'test-documents' && sourceBucket.download.mock.calls.length === 0
          ? sourceBucket as any : targetBucket as any },
      },
    })

    expect(uploaded).toHaveBeenCalledWith('classrooms/copied.pdf', bytes, {
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
})
