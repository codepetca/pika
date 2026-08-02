import { describe, expect, it, vi } from 'vitest'
import { copyManagedTestDocumentsForBlueprintOperation } from '@/lib/server/course-blueprint-managed-storage'

const SOURCE_ID = '20000000-0000-4000-8000-000000000001'
const USER_ID = '20000000-0000-4000-8000-000000000002'
const OPERATION_ID = '20000000-0000-4000-8000-000000000003'
const CLASSROOM_ID = '20000000-0000-4000-8000-000000000004'
const BLUEPRINT_ID = '20000000-0000-4000-8000-000000000005'

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
      is: vi.fn(() => query),
      single: vi.fn(async () => ({
        data: {
          id: SOURCE_ID,
          storage_bucket: 'test-documents',
          storage_path: 'classrooms/source.pdf',
          status: 'ready',
          content_type: 'application/pdf',
          classroom_id: CLASSROOM_ID,
          course_blueprint_id: null,
          provisional_owner_id: null,
        },
        error: null,
      })),
    }
    const upload = vi.fn(async (path: string, bytes: Uint8Array) => {
      uploaded.set(path, bytes)
      return { data: { path }, error: null }
    })
    const storage = {
      from: vi.fn(() => ({
        download: vi.fn(async (path: string) => ({
          data: new Blob([uploaded.get(path) || new Uint8Array([1, 2, 3])], {
            type: 'application/pdf',
          }),
          error: null,
        })),
        upload,
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
      sourceClassroomId: CLASSROOM_ID,
      assessments: [{
        id: 'assessment',
        documents: [{
          id: 'document', title: 'Source', source: 'upload',
          url: 'https://project.supabase.co/storage/v1/object/public/test-documents/classrooms/source.pdf',
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

  it.each([
    { direction: 'to_blueprint' as const, ownerColumn: 'classroom_id' },
    { direction: 'to_classroom' as const, ownerColumn: 'course_blueprint_id' },
  ])('resolves a registered legacy upload before copying $direction', async ({
    direction, ownerColumn,
  }) => {
    const uploaded = new Map<string, Uint8Array>()
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'managed_storage_blueprint_protocol_ready'
        || name === 'begin_managed_storage_provisional_owner') {
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
      is: vi.fn(() => query),
      single: vi.fn(async () => ({
        data: {
          id: SOURCE_ID,
          storage_bucket: 'test-documents',
          storage_path: 'legacy/source.pdf',
          status: 'ready',
          content_type: 'application/pdf',
          classroom_id: direction === 'to_blueprint' ? CLASSROOM_ID : null,
          course_blueprint_id: direction === 'to_classroom' ? BLUEPRINT_ID : null,
          provisional_owner_id: null,
        },
        error: null,
      })),
    }
    const upload = vi.fn(async (path: string, bytes: Uint8Array) => {
      uploaded.set(path, bytes)
      return { data: { path }, error: null }
    })
    const storage = {
      from: vi.fn(() => ({
        download: vi.fn(async (path: string) => ({
          data: new Blob([uploaded.get(path) || new Uint8Array([4, 5, 6])], {
            type: 'application/pdf',
          }),
          error: null,
        })),
        upload,
        getPublicUrl: vi.fn((path: string) => ({
          data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/test-documents/${path}` },
        })),
      })),
    }
    const result = await copyManagedTestDocumentsForBlueprintOperation({
      supabase: { rpc, from: vi.fn(() => query), storage },
      teacherId: USER_ID,
      operationId: OPERATION_ID,
      direction,
      ...(direction === 'to_blueprint'
        ? { sourceClassroomId: CLASSROOM_ID }
        : { sourceCourseBlueprintId: BLUEPRINT_ID }),
      assessments: [{
        id: 'assessment',
        documents: [
          {
            id: 'legacy-document-a', title: 'Legacy A', source: 'upload',
            url: 'https://project.supabase.co/storage/v1/object/public/test-documents/legacy/source.pdf',
          },
          {
            id: 'legacy-document-b', title: 'Legacy B', source: 'upload',
            url: 'https://project.supabase.co/storage/v1/object/public/test-documents/legacy/source.pdf',
          },
        ],
      }],
    })
    expect(result[0].documents[0].managed_object_id).toBeTruthy()
    expect(result[0].documents[0].managed_object_id).not.toBe(SOURCE_ID)
    expect(result[0].documents[0].url).not.toContain('/legacy/source.pdf')
    expect(result[0].documents[1]).toMatchObject({
      id: 'legacy-document-b',
      title: 'Legacy B',
      managed_object_id: result[0].documents[0].managed_object_id,
      url: result[0].documents[0].url,
    })
    expect(upload).toHaveBeenCalledTimes(1)
    expect(query.eq).toHaveBeenCalledWith(ownerColumn, direction === 'to_blueprint'
      ? CLASSROOM_ID
      : BLUEPRINT_ID)
  })
})
