import { describe, expect, it, vi } from 'vitest'
import {
  resumeCourseBlueprintStorageCopies,
} from '@/lib/server/course-blueprint-storage-copies'

const operationId = '10000000-0000-4000-8000-000000000001'
const teacherId = '20000000-0000-4000-8000-000000000002'
const sourceBytes = new Uint8Array([1, 2, 3, 4])
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

function createClient(options: {
  sourceBytes?: Uint8Array
  targetBytes?: Uint8Array
  uploadError?: boolean
  rotationResult?: boolean
} = {}) {
  const currentSourceBytes = options.sourceBytes ?? sourceBytes
  let currentItem = { ...item }
  const stored = new Map<string, Uint8Array>()
  if (options.targetBytes) stored.set(item.target_storage_path, options.targetBytes)
  if (options.uploadError) stored.set(item.target_storage_path, sourceBytes)
  let copyCompleted = false
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'adopt_course_blueprint_storage_copies') {
      return copyCompleted
        ? { data: { ok: true }, error: null }
        : { data: { ok: false, error_code: 'blueprint_storage_copy_incomplete', retryable: true }, error: null }
    }
    if (name === 'claim_course_blueprint_storage_copy') {
      return { data: copyCompleted ? [] : [currentItem], error: null }
    }
    if (name === 'rotate_course_blueprint_storage_copy_target') {
      if (options.rotationResult === false) return { data: false, error: null }
      const nextId = String(args?.p_target_object_id)
      currentItem = {
        ...currentItem,
        target_storage_path: `blueprints/target/tests/materials/${nextId}.pdf`,
      }
      return { data: true, error: null }
    }
    if (name === 'complete_course_blueprint_storage_copy') {
      copyCompleted = true
      return { data: true, error: null }
    }
    if (name === 'fail_course_blueprint_storage_copy') return { data: true, error: null }
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
      from(bucket: string) {
        return {
          async download(path: string) {
            if (path === item.source_storage_path) {
              return { data: new Blob([currentSourceBytes]), error: null }
            }
            const bytes = stored.get(path)
            return bytes
              ? { data: new Blob([bytes]), error: null }
              : { data: null, error: { message: 'not found' } }
          },
          upload,
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://example.test/${bucket}/${path}` } }
          },
        }
      },
    },
  }
  return { client, rpc, upload, stored, currentPath: () => currentItem.target_storage_path }
}

describe('Course Blueprint managed storage copies', () => {
  it('copies, reads back, verifies, and adopts an owned target generation', async () => {
    const { client, rpc, upload } = createClient()
    await resumeCourseBlueprintStorageCopies({ operationId, teacherId, supabase: client })

    expect(upload).toHaveBeenCalledWith(item.target_storage_path, expect.any(Uint8Array), {
      contentType: 'application/pdf', upsert: false,
    })
    expect(rpc).toHaveBeenCalledWith(
      'complete_course_blueprint_storage_copy',
      expect.objectContaining({ p_content_sha256: item.expected_sha256 }),
    )
    expect(rpc).toHaveBeenLastCalledWith('adopt_course_blueprint_storage_copies', {
      p_operation_id: operationId, p_teacher_id: teacherId,
    })
  })

  it('resumes after an earlier worker uploaded the current immutable generation', async () => {
    const { client, rpc } = createClient({ uploadError: true })
    await resumeCourseBlueprintStorageCopies({ operationId, teacherId, supabase: client })
    expect(rpc).toHaveBeenCalledWith('complete_course_blueprint_storage_copy', expect.any(Object))
  })

  it('abandons a mismatched generation, reserves a new path, and never deletes or reuses the old path', async () => {
    const wrongBytes = new Uint8Array([9, 9, 9, 9])
    const { client, rpc, upload, stored, currentPath } = createClient({ targetBytes: wrongBytes })

    await resumeCourseBlueprintStorageCopies({ operationId, teacherId, supabase: client })

    expect(rpc).toHaveBeenCalledWith(
      'rotate_course_blueprint_storage_copy_target',
      expect.objectContaining({ p_item_id: item.id, p_teacher_id: teacherId }),
    )
    expect(currentPath()).not.toBe(item.target_storage_path)
    expect(stored.get(item.target_storage_path)).toEqual(wrongBytes)
    expect(stored.get(currentPath())).toEqual(sourceBytes)
    expect(upload).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledWith(
      'complete_course_blueprint_storage_copy',
      expect.objectContaining({ p_content_sha256: item.expected_sha256 }),
    )
  })

  it('fails safely without deleting either generation when rotation loses its lease', async () => {
    const wrongBytes = new Uint8Array([9, 9, 9, 9])
    const { client, stored, currentPath } = createClient({
      targetBytes: wrongBytes,
      rotationResult: false,
    })

    await expect(resumeCourseBlueprintStorageCopies({
      operationId, teacherId, supabase: client,
    })).rejects.toMatchObject({
      code: 'blueprint_storage_copy_generation_lease_lost',
      retryable: true,
    })
    expect(currentPath()).toBe(item.target_storage_path)
    expect(stored.get(item.target_storage_path)).toEqual(wrongBytes)
  })

  it('records source evidence drift as blocked instead of indefinitely retryable', async () => {
    const { client, rpc, upload } = createClient({
      sourceBytes: new Uint8Array([8, 8, 8, 8]),
    })

    await expect(resumeCourseBlueprintStorageCopies({
      operationId, teacherId, supabase: client,
    })).rejects.toMatchObject({
      code: 'blueprint_storage_copy_source_changed',
      retryable: false,
    })
    expect(upload).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('fail_course_blueprint_storage_copy', {
      p_item_id: item.id,
      p_teacher_id: teacherId,
      p_lease_token: expect.any(String),
      p_error_code: 'blueprint_storage_copy_source_changed',
      p_retryable: false,
    })
  })
})
