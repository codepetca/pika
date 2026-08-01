import { describe, expect, it, vi } from 'vitest'
import {
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
  last_error_code: null,
}

function createClient(options: {
  targetBytes?: Uint8Array
  uploadError?: boolean
  removeError?: unknown
  targetResetResult?: boolean
  cleanupReservationResult?: boolean
  cleanupClaimFirst?: boolean
  replacementWinsBeforeCleanupReservation?: boolean
} = {}) {
  const sourceBytes = new Uint8Array([1, 2, 3, 4])
  let targetBytes = options.targetBytes
    ?? (options.uploadError ? sourceBytes : null)
  let copyCompleted = false
  let cleanupClaimed = false
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'adopt_course_blueprint_storage_copies') {
      return !copyCompleted
        ? { data: { ok: false, error_code: 'blueprint_storage_copy_incomplete', retryable: true }, error: null }
        : { data: { ok: true }, error: null }
    }
    if (name === 'claim_course_blueprint_storage_copy') {
      if (options.cleanupClaimFirst && !cleanupClaimed) {
        cleanupClaimed = true
        return {
          data: [{
            ...item,
            last_error_code: 'blueprint_storage_copy_cleanup_processing',
          }],
          error: null,
        }
      }
      return { data: copyCompleted ? [] : [item], error: null }
    }
    if (name === 'complete_course_blueprint_storage_copy') {
      copyCompleted = true
      return { data: true, error: null }
    }
    if (name === 'fail_course_blueprint_storage_copy') {
      if (args?.p_error_code === 'blueprint_storage_copy_cleanup_started') {
        if (options.replacementWinsBeforeCleanupReservation) {
          targetBytes = new Uint8Array(sourceBytes)
          copyCompleted = true
          return { data: false, error: null }
        }
        return { data: options.cleanupReservationResult ?? true, error: null }
      }
      if (args?.p_error_code === 'blueprint_storage_copy_target_removed') {
        return { data: options.targetResetResult ?? true, error: null }
      }
      copyCompleted = true
      return { data: true, error: null }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  const upload = vi.fn(async (_path: string, body: Uint8Array) => {
    if (targetBytes !== null) {
      return { error: { message: 'already exists' } }
    }
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
      from(bucket: string) {
        return {
          async download(path: string) {
            if (path === item.source_storage_path) {
              return { data: new Blob([sourceBytes]), error: null }
            }
            return targetBytes
              ? { data: new Blob([targetBytes]), error: null }
              : { data: null, error: { message: 'not found' } }
          },
          upload,
          remove,
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://example.test/${bucket}/${path}` } }
          },
        }
      },
    },
  }
  return { client, rpc, upload, remove, getTargetBytes: () => targetBytes }
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

  it('removes a mismatched deterministic target, proves absence, and retries the copy', async () => {
    const { client, rpc, remove, upload } = createClient({
      targetBytes: new Uint8Array([9, 9, 9, 9]),
    })
    await resumeCourseBlueprintStorageCopies({
      operationId,
      teacherId,
      supabase: client,
    })
    expect(remove).toHaveBeenCalledWith([item.target_storage_path])
    expect(rpc).toHaveBeenCalledWith(
      'fail_course_blueprint_storage_copy',
      expect.objectContaining({
        p_error_code: 'blueprint_storage_copy_cleanup_started',
      }),
    )
    const reservationCall = rpc.mock.invocationCallOrder[
      rpc.mock.calls.findIndex(([, args]) => (
        args as Record<string, unknown> | undefined
      )?.p_error_code === 'blueprint_storage_copy_cleanup_started')
    ]
    expect(reservationCall).toBeLessThan(remove.mock.invocationCallOrder[0])
    expect(upload).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledWith(
      'complete_course_blueprint_storage_copy',
      expect.objectContaining({ p_content_sha256: item.expected_sha256 }),
    )
  })

  it('keeps a mismatched target retryable when Storage removal fails', async () => {
    const { client, rpc } = createClient({
      targetBytes: new Uint8Array([9, 9, 9, 9]),
      removeError: { statusCode: 503 },
    })

    await expect(resumeCourseBlueprintStorageCopies({
      operationId,
      teacherId,
      supabase: client,
    })).rejects.toMatchObject({
      code: 'blueprint_storage_copy_mismatch_cleanup_failed',
      retryable: true,
    })
    expect(rpc).toHaveBeenCalledWith(
      'fail_course_blueprint_storage_copy',
      expect.objectContaining({
        p_error_code: 'blueprint_storage_copy_mismatch_cleanup_failed',
      }),
    )
  })

  it('fails safely when the cleanup lease is lost after target removal', async () => {
    const { client } = createClient({
      targetBytes: new Uint8Array([9, 9, 9, 9]),
      targetResetResult: false,
    })

    await expect(resumeCourseBlueprintStorageCopies({
      operationId,
      teacherId,
      supabase: client,
    })).rejects.toMatchObject({
      code: 'blueprint_storage_copy_cleanup_lease_lost',
      retryable: true,
    })
  })

  it('never removes a target when the copy lease is lost before cleanup reservation', async () => {
    const { client, remove } = createClient({
      targetBytes: new Uint8Array([9, 9, 9, 9]),
      cleanupReservationResult: false,
    })

    await expect(resumeCourseBlueprintStorageCopies({
      operationId,
      teacherId,
      supabase: client,
    })).rejects.toMatchObject({
      code: 'blueprint_storage_copy_cleanup_lease_lost',
      retryable: true,
    })
    expect(remove).not.toHaveBeenCalled()
  })

  it('cannot remove a replacement worker target after its stale lease expires', async () => {
    const { client, remove, getTargetBytes } = createClient({
      targetBytes: new Uint8Array([9, 9, 9, 9]),
      replacementWinsBeforeCleanupReservation: true,
    })

    await expect(resumeCourseBlueprintStorageCopies({
      operationId,
      teacherId,
      supabase: client,
    })).rejects.toMatchObject({
      code: 'blueprint_storage_copy_cleanup_lease_lost',
    })

    expect(remove).not.toHaveBeenCalled()
    expect(getTargetBytes()).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('reclaims an expired cleanup lease without uploading before exact absence', async () => {
    const { client, remove, upload } = createClient({
      targetBytes: new Uint8Array([9, 9, 9, 9]),
      cleanupClaimFirst: true,
    })

    await resumeCourseBlueprintStorageCopies({ operationId, teacherId, supabase: client })

    expect(remove).toHaveBeenCalledWith([item.target_storage_path])
    expect(upload).toHaveBeenCalledTimes(1)
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(upload.mock.invocationCallOrder[0])
  })
})
