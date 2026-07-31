import { describe, expect, it, vi } from 'vitest'
import {
  ManagedStorageBackfillError,
  backfillAllClassroomManagedStorage,
  collectManagedStorageBlueprintReferences,
  collectManagedStorageBackfillCandidates,
} from '@/lib/server/managed-storage-backfill'

const teacherId = '10000000-0000-4000-8000-000000000001'
const firstClassroomId = '20000000-0000-4000-8000-000000000002'
const secondClassroomId = '30000000-0000-4000-8000-000000000003'
const testId = '40000000-0000-4000-8000-000000000004'

describe('managed storage legacy backfill', () => {
  it('discovers mutable Blueprint documents and immutable Version evidence without treating Versions as rewrite targets', () => {
    const blueprintId = '90000000-0000-4000-8000-000000000009'
    const versionId = 'a0000000-0000-4000-8000-000000000010'
    const references = collectManagedStorageBlueprintReferences({
      supabaseUrl: 'https://project.supabase.co',
      blueprints: [{ id: blueprintId, teacher_id: teacherId }],
      assessments: [{
        id: testId,
        course_blueprint_id: blueprintId,
        documents: [{
          id: 'mutable-document',
          source: 'upload',
          url: 'https://project.supabase.co/storage/v1/object/public/test-documents/legacy/blueprint.pdf',
        }],
      }],
      versions: [{
        id: versionId,
        course_blueprint_id: blueprintId,
        snapshot_json: {
          assessments: [{
            artifact_id: testId,
            documents: [{
              id: 'version-document',
              source: 'upload',
              url: 'https://project.supabase.co/storage/v1/object/public/test-documents/legacy/blueprint.pdf',
            }],
          }],
        },
      }],
    })

    expect(references).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'mutable_assessment',
        blueprintId,
        path: 'legacy/blueprint.pdf',
        versionId: null,
      }),
      expect.objectContaining({
        source: 'immutable_version',
        blueprintId,
        path: 'legacy/blueprint.pdf',
        versionId,
      }),
    ]))
  })

  it('uses assignment artifacts and execution snapshots in the exact candidate inventory', () => {
    const candidates = collectManagedStorageBackfillCandidates({
      supabaseUrl: 'https://project.supabase.co',
      resources: {
        assignment_submission_artifacts: [{
          id: 'artifact',
          assignment_doc_id: '60000000-0000-4000-8000-000000000006',
          student_id: '70000000-0000-4000-8000-000000000007',
          storage_path: 'legacy/artifact.png',
        }],
        tests: [{
          id: testId,
          documents: [{
            id: 'snapshot',
            source: 'link',
            url: 'https://example.invalid/source',
            snapshot_path: 'legacy/snapshot.pdf',
          }],
        }],
      },
    })
    expect(candidates.map(({ bucket, path, purpose }) => ({ bucket, path, purpose })))
      .toEqual([{
        bucket: 'assignment-artifacts',
        path: 'legacy/artifact.png',
        purpose: 'student_assignment_artifact',
      }, {
        bucket: 'test-documents',
        path: 'legacy/snapshot.pdf',
        purpose: 'test_execution_snapshot',
      }])
  })

  it('rejects a cross-classroom shared path before writing ownership', async () => {
    const rpc = vi.fn()
    const sharedArtifact = {
      id: '50000000-0000-4000-8000-000000000005',
      assignment_doc_id: '60000000-0000-4000-8000-000000000006',
      student_id: '70000000-0000-4000-8000-000000000007',
      storage_path: 'legacy/shared.pdf',
    }
    await expect(backfillAllClassroomManagedStorage({
      inventoryScope: 'all_classrooms',
      supabase: { rpc, from: vi.fn() },
      supabaseUrl: 'https://project.supabase.co',
      classrooms: [firstClassroomId, secondClassroomId].map((classroomId) => ({
        classroomId,
        teacherId,
        expectedSourceRevision: 3,
        resources: { assignment_submission_artifacts: [sharedArtifact] },
      })),
    })).rejects.toMatchObject<ManagedStorageBackfillError>({
      code: 'legacy_storage_reference_shared',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('registers and attaches teacher material before verifying coverage', async () => {
    const objectId = '80000000-0000-4000-8000-000000000008'
    const calls: string[] = []
    const rpc = vi.fn(async (name: string) => {
      calls.push(name)
      if (name === 'register_legacy_classroom_storage_object') {
        return {
          data: {
            id: objectId,
            storage_bucket: 'test-documents',
            storage_path: 'legacy/test.pdf',
            classroom_id: firstClassroomId,
            course_blueprint_id: null,
            purpose: 'teacher_test_material',
            status: 'ready',
            created_by_user_id: teacherId,
            data_subject_user_id: null,
            resource_type: 'test',
            resource_id: testId,
            content_type: null,
            byte_size: null,
            content_sha256: null,
            upload_expires_at: null,
            attempt_count: 0,
            next_attempt_at: '2026-07-31T12:00:00.000Z',
            lease_token: null,
            lease_expires_at: null,
            last_error_code: null,
            created_at: '2026-07-31T12:00:00.000Z',
            ready_at: '2026-07-31T12:00:00.000Z',
            updated_at: '2026-07-31T12:00:00.000Z',
          },
          error: null,
        }
      }
      return { data: true, error: null }
    })
    const from = vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { revision: 3 }, error: null }),
        }),
      }),
    }))
    await backfillAllClassroomManagedStorage({
      inventoryScope: 'all_classrooms',
      supabase: { rpc, from },
      supabaseUrl: 'https://project.supabase.co',
      classrooms: [{
        classroomId: firstClassroomId,
        teacherId,
        expectedSourceRevision: 3,
        resources: {
          tests: [{
            id: testId,
            documents: [{
              id: 'material',
              title: 'Material',
              source: 'upload',
              url: 'https://project.supabase.co/storage/v1/object/public/test-documents/legacy/test.pdf',
            }],
          }],
        },
      }],
    })
    expect(calls).toEqual([
      'register_legacy_classroom_storage_object',
      'attach_legacy_test_document_managed_object',
      'verify_classroom_managed_storage_coverage',
    ])
  })

  it('rejects all-class revision drift before the first ownership write', async () => {
    const rpc = vi.fn()
    const from = vi.fn(() => ({
      select: () => ({
        eq: (_column: string, classroomId: string) => ({
          single: async () => ({
            data: { revision: classroomId === secondClassroomId ? 4 : 3 },
            error: null,
          }),
        }),
      }),
    }))
    await expect(backfillAllClassroomManagedStorage({
      inventoryScope: 'all_classrooms',
      supabase: { rpc, from },
      supabaseUrl: 'https://project.supabase.co',
      classrooms: [{
        classroomId: firstClassroomId,
        teacherId,
        expectedSourceRevision: 3,
        resources: {},
      }, {
        classroomId: secondClassroomId,
        teacherId,
        expectedSourceRevision: 3,
        resources: {},
      }],
    })).rejects.toMatchObject<ManagedStorageBackfillError>({
      code: 'legacy_storage_revision_drift',
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})
