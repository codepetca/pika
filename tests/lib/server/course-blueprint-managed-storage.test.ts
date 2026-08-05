import { describe, expect, it, vi } from 'vitest'
import { copyManagedTestDocumentsForBlueprintOperation } from '@/lib/server/course-blueprint-managed-storage'

const SOURCE_ID = '20000000-0000-4000-8000-000000000001'
const USER_ID = '20000000-0000-4000-8000-000000000002'
const OPERATION_ID = '20000000-0000-4000-8000-000000000003'
const CLASSROOM_ID = '20000000-0000-4000-8000-000000000004'
const BLUEPRINT_ID = '20000000-0000-4000-8000-000000000005'

function makeOperationLookup(status: string | null = null) {
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({
      data: status ? { status } : null,
      error: null,
    })),
  }
  return vi.fn(() => builder)
}

describe('course Blueprint managed storage copies', () => {
  it('copies through a provisional owner and returns a distinct managed identity', async () => {
    const uploaded = new Map<string, Uint8Array>()
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'managed_storage_blueprint_protocol_ready') {
        return { data: true, error: null }
      }
      if (name === 'resolve_managed_storage_blueprint_copy_source') {
        return {
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
        }
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
      supabase: { rpc, storage, from: makeOperationLookup() },
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
    expect(result.assessments[0].documents[0].managed_object_id).not.toBe(SOURCE_ID)
    expect(result.assessments[0].documents[0].url).toContain(`/managed-copies/${OPERATION_ID}/`)
    expect(result.cleanupObjectIds).toEqual([
      result.assessments[0].documents[0].managed_object_id,
    ])
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'managed_storage_blueprint_protocol_ready',
      'resolve_managed_storage_blueprint_copy_source',
      'begin_managed_storage_provisional_owner',
      'begin_managed_storage_upload',
      'get_managed_storage_object_presence',
      'verify_managed_storage_upload',
    ])
  })

  it('reuses the same verified copy for an incomplete operation retry', async () => {
    const uploaded = new Map<string, Uint8Array>()
    let targetStatus = 'reserved'
    let targetObjectId = ''
    let targetPath = ''
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'managed_storage_blueprint_protocol_ready'
        || name === 'begin_managed_storage_provisional_owner') {
        return { data: true, error: null }
      }
      if (name === 'resolve_managed_storage_blueprint_copy_source') {
        return {
          data: {
            id: SOURCE_ID,
            storage_bucket: 'test-documents',
            storage_path: 'classrooms/retry-source.pdf',
            status: 'ready',
            content_type: 'application/pdf',
            classroom_id: CLASSROOM_ID,
            course_blueprint_id: null,
            provisional_owner_id: null,
          },
          error: null,
        }
      }
      if (name === 'begin_managed_storage_upload') {
        targetObjectId = String(args.p_object_id)
        targetPath = String(args.p_storage_path)
        return {
          data: {
            id: targetObjectId,
            storage_bucket: 'test-documents',
            storage_path: targetPath,
            status: targetStatus,
          },
          error: null,
        }
      }
      if (name === 'get_managed_storage_object_presence') {
        return {
          data: { bucket_exists: true, object_exists: uploaded.has(targetPath) },
          error: null,
        }
      }
      targetStatus = 'verified'
      return {
        data: {
          id: targetObjectId,
          storage_bucket: 'test-documents',
          storage_path: targetPath,
          status: 'verified',
        },
        error: null,
      }
    })
    const upload = vi.fn(async (path: string, bytes: Uint8Array) => {
      uploaded.set(path, bytes)
      return { data: { path }, error: null }
    })
    const storage = {
      from: vi.fn(() => ({
        download: vi.fn(async (path: string) => ({
          data: new Blob([uploaded.get(path) || new Uint8Array([9, 8, 7])], {
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
    const request = {
      supabase: { rpc, storage, from: makeOperationLookup('failed') },
      teacherId: USER_ID,
      operationId: OPERATION_ID,
      direction: 'to_blueprint' as const,
      sourceClassroomId: CLASSROOM_ID,
      assessments: [{
        documents: [{
          id: 'retry-document', title: 'Retry', source: 'upload' as const,
          url: 'https://project.supabase.co/storage/v1/object/public/test-documents/classrooms/retry-source.pdf',
          managed_object_id: SOURCE_ID,
        }],
      }],
    }

    const first = await copyManagedTestDocumentsForBlueprintOperation(request)
    const second = await copyManagedTestDocumentsForBlueprintOperation(request)

    expect(second.assessments[0].documents[0].managed_object_id)
      .toBe(first.assessments[0].documents[0].managed_object_id)
    expect(second.assessments[0].documents[0].url)
      .toBe(first.assessments[0].documents[0].url)
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('preflights a completed operation without creating another copy', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'managed_storage_blueprint_protocol_ready') {
        return { data: true, error: null }
      }
      if (name === 'resolve_managed_storage_blueprint_copy_source') {
        return {
          data: {
            id: SOURCE_ID,
            storage_bucket: 'test-documents',
            storage_path: 'classrooms/completed-source.pdf',
            status: 'ready',
            content_type: 'application/pdf',
            classroom_id: CLASSROOM_ID,
            course_blueprint_id: null,
            provisional_owner_id: null,
          },
          error: null,
        }
      }
      throw new Error(`Unexpected RPC ${name}`)
    })
    const storage = {
      from: vi.fn(() => ({
        download: vi.fn(),
        upload: vi.fn(),
        getPublicUrl: vi.fn((path: string) => ({
          data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/test-documents/${path}` },
        })),
      })),
    }
    const result = await copyManagedTestDocumentsForBlueprintOperation({
      supabase: { rpc, storage, from: makeOperationLookup('completed') },
      teacherId: USER_ID,
      operationId: OPERATION_ID,
      direction: 'to_blueprint',
      sourceClassroomId: CLASSROOM_ID,
      assessments: [{
        documents: [{
          id: 'completed-document', title: 'Completed', source: 'upload',
          url: 'https://project.supabase.co/storage/v1/object/public/test-documents/classrooms/completed-source.pdf',
          managed_object_id: SOURCE_ID,
        }],
      }],
    })

    expect(result.cleanupObjectIds).toEqual([])
    expect(result.assessments[0].documents[0]).toMatchObject({
      managed_object_id: expect.not.stringMatching(SOURCE_ID),
      url: expect.stringContaining(`/managed-copies/${OPERATION_ID}/`),
    })
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'managed_storage_blueprint_protocol_ready',
      'resolve_managed_storage_blueprint_copy_source',
    ])
  })

  it.each([
    { direction: 'to_blueprint' as const },
    { direction: 'to_classroom' as const },
  ])('resolves a registered legacy upload before copying $direction', async ({
    direction,
  }) => {
    const uploaded = new Map<string, Uint8Array>()
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'managed_storage_blueprint_protocol_ready'
        || name === 'begin_managed_storage_provisional_owner') {
        return { data: true, error: null }
      }
      if (name === 'resolve_managed_storage_blueprint_copy_source') {
        return {
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
        }
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
      supabase: { rpc, storage, from: makeOperationLookup() },
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
    expect(result.assessments[0].documents[0].managed_object_id).toBeTruthy()
    expect(result.assessments[0].documents[0].managed_object_id).not.toBe(SOURCE_ID)
    expect(result.assessments[0].documents[0].url).not.toContain('/legacy/source.pdf')
    expect(result.assessments[0].documents[1]).toMatchObject({
      id: 'legacy-document-b',
      title: 'Legacy B',
      managed_object_id: result.assessments[0].documents[0].managed_object_id,
      url: result.assessments[0].documents[0].url,
    })
    expect(upload).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith(
      'resolve_managed_storage_blueprint_copy_source',
      expect.objectContaining({
        p_storage_path: 'legacy/source.pdf',
        p_managed_object_id: null,
      }),
    )
  })

  it.each([
    { direction: 'to_blueprint' as const },
    { direction: 'to_classroom' as const },
  ])('copies an unregistered legacy upload only during compatibility: $direction', async ({
    direction,
  }) => {
    const uploaded = new Map<string, Uint8Array>()
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'managed_storage_blueprint_protocol_ready'
        || name === 'begin_managed_storage_provisional_owner') {
        return { data: true, error: null }
      }
      if (name === 'resolve_managed_storage_blueprint_copy_source') {
        return {
          data: {
            id: SOURCE_ID,
            storage_bucket: 'test-documents',
            storage_path: 'legacy/unregistered.pdf',
            status: 'ready',
            content_type: null,
            classroom_id: direction === 'to_blueprint' ? CLASSROOM_ID : null,
            course_blueprint_id: direction === 'to_classroom' ? BLUEPRINT_ID : null,
            provisional_owner_id: null,
          },
          error: null,
        }
      }
      return {
        data: {
          id: args.p_object_id,
          storage_bucket: 'test-documents',
          storage_path: 'p_storage_path' in args
            ? args.p_storage_path
            : [...uploaded.keys()][0],
          status: name === 'verify_managed_storage_upload' ? 'verified' : 'reserved',
        },
        error: null,
      }
    })
    const upload = vi.fn(async (path: string, bytes: Uint8Array) => {
      uploaded.set(path, bytes)
      return { data: { path }, error: null }
    })
    const storage = {
      from: vi.fn(() => ({
        download: vi.fn(async (path: string) => ({
          data: new Blob([uploaded.get(path) || new Uint8Array([7, 8, 9])], {
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
      supabase: { rpc, storage, from: makeOperationLookup() },
      teacherId: USER_ID,
      operationId: OPERATION_ID,
      direction,
      ...(direction === 'to_blueprint'
        ? { sourceClassroomId: CLASSROOM_ID }
        : { sourceCourseBlueprintId: BLUEPRINT_ID }),
      assessments: [{
        documents: [{
          id: 'legacy-document', title: 'Legacy', source: 'upload',
          url: 'https://project.supabase.co/storage/v1/object/public/test-documents/legacy/unregistered.pdf',
        }],
      }],
    })

    expect(result.assessments[0].documents[0]).toMatchObject({
      managed_object_id: expect.any(String),
      url: expect.stringContaining(`/managed-copies/${OPERATION_ID}/`),
    })
    expect(result.assessments[0].documents[0].url).not.toContain('/legacy/unregistered.pdf')
    expect(upload).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith(
      'resolve_managed_storage_blueprint_copy_source',
      expect.objectContaining({
        p_storage_path: 'legacy/unregistered.pdf',
        p_managed_object_id: null,
      }),
    )
  })

  it('rejects an unregistered legacy upload after enforcement', async () => {
    const rpc = vi.fn(async (name: string) => name === 'managed_storage_blueprint_protocol_ready'
      ? { data: true, error: null }
      : { data: null, error: { code: '55000' } })
    const storage = { from: vi.fn() }

    await expect(copyManagedTestDocumentsForBlueprintOperation({
      supabase: { rpc, storage },
      teacherId: USER_ID,
      operationId: OPERATION_ID,
      direction: 'to_blueprint',
      sourceClassroomId: CLASSROOM_ID,
      assessments: [{
        documents: [{
          id: 'legacy-document', title: 'Legacy', source: 'upload',
          url: 'https://project.supabase.co/storage/v1/object/public/test-documents/legacy/unregistered.pdf',
        }],
      }],
    })).rejects.toThrow('managed_storage_blueprint_copy_source_invalid')
    expect(storage.from).not.toHaveBeenCalled()
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'managed_storage_blueprint_protocol_ready',
      'resolve_managed_storage_blueprint_copy_source',
    ])
  })

  it('never treats a missing explicit managed identity as a legacy source', async () => {
    const rpc = vi.fn(async (name: string) => name === 'managed_storage_blueprint_protocol_ready'
      ? { data: true, error: null }
      : { data: null, error: { code: '55000' } })

    await expect(copyManagedTestDocumentsForBlueprintOperation({
      supabase: { rpc, storage: { from: vi.fn() } },
      teacherId: USER_ID,
      operationId: OPERATION_ID,
      direction: 'to_blueprint',
      sourceClassroomId: CLASSROOM_ID,
      assessments: [{
        documents: [{
          id: 'managed-document', title: 'Managed', source: 'upload',
          url: 'https://project.supabase.co/storage/v1/object/public/test-documents/managed/missing.pdf',
          managed_object_id: SOURCE_ID,
        }],
      }],
    })).rejects.toThrow('managed_storage_blueprint_copy_source_invalid')
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'managed_storage_blueprint_protocol_ready',
      'resolve_managed_storage_blueprint_copy_source',
    ])
  })

  it('never treats an owner-mismatched managed path as an unregistered source', async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: name === 'managed_storage_blueprint_protocol_ready'
        ? true
        : {
          id: SOURCE_ID,
          storage_bucket: 'test-documents',
          storage_path: 'managed/wrong-owner.pdf',
          status: 'ready',
          content_type: 'application/pdf',
          classroom_id: '20000000-0000-4000-8000-000000000099',
          course_blueprint_id: null,
          provisional_owner_id: null,
        },
      error: null,
    }))

    await expect(copyManagedTestDocumentsForBlueprintOperation({
      supabase: { rpc, storage: { from: vi.fn() } },
      teacherId: USER_ID,
      operationId: OPERATION_ID,
      direction: 'to_blueprint',
      sourceClassroomId: CLASSROOM_ID,
      assessments: [{
        documents: [{
          id: 'raw-document', title: 'Raw', source: 'upload',
          url: 'https://project.supabase.co/storage/v1/object/public/test-documents/managed/wrong-owner.pdf',
        }],
      }],
    })).rejects.toThrow('managed_storage_blueprint_copy_source_invalid')
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'managed_storage_blueprint_protocol_ready',
      'resolve_managed_storage_blueprint_copy_source',
    ])
  })
})
