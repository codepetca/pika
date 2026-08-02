import { describe, expect, it, vi } from 'vitest'
import { copyManagedTestDocumentsForBlueprintOperation } from '@/lib/server/course-blueprint-managed-storage'

const SOURCE_ID = '20000000-0000-4000-8000-000000000001'
const USER_ID = '20000000-0000-4000-8000-000000000002'
const OPERATION_ID = '20000000-0000-4000-8000-000000000003'

describe('course Blueprint managed storage copies', () => {
  it('copies through a provisional owner and returns a distinct managed identity', async () => {
    const uploaded = new Map<string, Uint8Array>()
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'managed_storage_blueprint_protocol_ready') {
        return { data: true, error: null }
      }
      if (name === 'begin_managed_storage_provisional_owner') {
        return { data: true, error: null }
      }
      return {
        data: {
          id: args.p_object_id,
          storage_bucket: 'test-documents',
          storage_path: 'p_storage_path' in args ? args.p_storage_path : [...uploaded.keys()][0],
          status: name === 'verify_managed_storage_upload' ? 'verified' : 'reserved',
        },
        error: null,
      }
    })
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      single: vi.fn(async () => ({
        data: {
          id: SOURCE_ID,
          storage_bucket: 'test-documents',
          storage_path: 'classrooms/source.pdf',
          status: 'ready',
          content_type: 'application/pdf',
        },
        error: null,
      })),
    }
    const storage = {
      from: vi.fn(() => ({
        download: vi.fn(async (path: string) => ({
          data: new Blob([uploaded.get(path) || new Uint8Array([1, 2, 3])], {
            type: 'application/pdf',
          }),
          error: null,
        })),
        upload: vi.fn(async (path: string, bytes: Uint8Array) => {
          uploaded.set(path, bytes)
          return { data: { path }, error: null }
        }),
        getPublicUrl: vi.fn((path: string) => ({
          data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/test-documents/${path}` },
        })),
      })),
    }
    const result = await copyManagedTestDocumentsForBlueprintOperation({
      supabase: { rpc, from: vi.fn(() => query), storage },
      teacherId: USER_ID,
      operationId: OPERATION_ID,
      direction: 'to_blueprint',
      assessments: [{
        id: 'assessment',
        documents: [{
          id: 'document', title: 'Source', source: 'upload',
          url: 'https://project.supabase.co/source.pdf',
          managed_object_id: SOURCE_ID,
        }],
      }],
    })
    expect(result[0].documents[0].managed_object_id).not.toBe(SOURCE_ID)
    expect(result[0].documents[0].url).toContain(`/managed-copies/${OPERATION_ID}/`)
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'managed_storage_blueprint_protocol_ready',
      'begin_managed_storage_provisional_owner',
      'begin_managed_storage_upload',
      'verify_managed_storage_upload',
    ])
  })
})
