import { describe, expect, it, vi } from 'vitest'
import {
  CourseBlueprintStorageCopyError,
  resumeCourseBlueprintStorageCopies,
} from '@/lib/server/course-blueprint-storage-copies'

const operationId = '10000000-0000-4000-8000-000000000001'
const teacherId = '20000000-0000-4000-8000-000000000002'
const item = {
  id: '30000000-0000-4000-8000-000000000003',
  operation_id: operationId,
  source_object_id: '40000000-0000-4000-8000-000000000004',
  source_storage_bucket: 'test-documents',
  source_storage_path: 'classrooms/source/tests/material.pdf',
  target_storage_bucket: 'test-documents',
  target_storage_path: 'blueprints/target/tests/material.pdf',
  content_type: 'application/pdf',
  expected_byte_size: 4,
  expected_sha256: '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a',
}

function createClient(options: { targetBytes?: Uint8Array; uploadError?: boolean } = {}) {
  const sourceBytes = new Uint8Array([1, 2, 3, 4])
  const targetBytes = options.targetBytes || sourceBytes
  let claimCount = 0
  let adoptionCount = 0
  const rpc = vi.fn(async (name: string) => {
    if (name === 'adopt_course_blueprint_storage_copies') {
      adoptionCount += 1
      return adoptionCount === 1
        ? { data: { ok: false, error_code: 'blueprint_storage_copy_incomplete', retryable: true }, error: null }
        : { data: { ok: true }, error: null }
    }
    if (name === 'claim_course_blueprint_storage_copy') {
      claimCount += 1
      return { data: claimCount === 1 ? [item] : [], error: null }
    }
    if (name === 'complete_course_blueprint_storage_copy') {
      return { data: true, error: null }
    }
    if (name === 'fail_course_blueprint_storage_copy') {
      return { data: true, error: null }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const upload = vi.fn(async () => ({
    error: options.uploadError ? { message: 'already exists' } : null,
  }))
  const client = {
    rpc,
    storage: {
      from(bucket: string) {
        return {
          async download(path: string) {
            const bytes = path === item.source_storage_path ? sourceBytes : targetBytes
            return { data: new Blob([bytes]), error: null }
          },
          upload,
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://example.test/${bucket}/${path}` } }
          },
        }
      },
    },
  }
  return { client, rpc, upload }
}

describe('Course Blueprint managed storage copies', () => {
  it('copies, reads back, verifies, and adopts a planned object', async () => {
    const { client, rpc, upload } = createClient()
    await resumeCourseBlueprintStorageCopies({
      operationId,
      teacherId,
      supabase: client,
    })
    expect(upload).toHaveBeenCalledWith(
      item.target_storage_path,
      expect.any(Uint8Array),
      { contentType: 'application/pdf', upsert: false },
    )
    expect(rpc).toHaveBeenCalledWith(
      'complete_course_blueprint_storage_copy',
      expect.objectContaining({ p_content_sha256: item.expected_sha256 }),
    )
    expect(rpc).toHaveBeenLastCalledWith(
      'adopt_course_blueprint_storage_copies',
      { p_operation_id: operationId, p_teacher_id: teacherId },
    )
  })

  it('resumes after an earlier worker uploaded the deterministic target', async () => {
    const { client, rpc } = createClient({ uploadError: true })
    await resumeCourseBlueprintStorageCopies({ operationId, teacherId, supabase: client })
    expect(rpc).toHaveBeenCalledWith(
      'complete_course_blueprint_storage_copy',
      expect.any(Object),
    )
  })

  it('fails closed and records evidence when read-back bytes differ', async () => {
    const { client, rpc } = createClient({ targetBytes: new Uint8Array([9, 9, 9, 9]) })
    await expect(resumeCourseBlueprintStorageCopies({
      operationId,
      teacherId,
      supabase: client,
    })).rejects.toMatchObject<CourseBlueprintStorageCopyError>({
      code: 'blueprint_storage_copy_verification_mismatch',
      retryable: false,
    })
    expect(rpc).toHaveBeenCalledWith(
      'fail_course_blueprint_storage_copy',
      expect.objectContaining({
        p_error_code: 'blueprint_storage_copy_verification_mismatch',
      }),
    )
  })
})
