import { describe, expect, it, vi } from 'vitest'
import {
  copyManagedTestDocumentsForBlueprintOperation,
  queueBlueprintManagedStorageCopiesBestEffort,
} from '@/lib/server/course-blueprint-managed-storage'

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
    expect(result.assessments[0].documents[0]).toMatchObject({
      storage_bucket: 'test-documents',
      storage_path: expect.stringContaining(`managed-copies/${OPERATION_ID}/`),
    })
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
        || name === 'begin_managed_storage_provisional_owner'
        || name === 'begin_managed_storage_blueprint_copy_owner'
        || name === 'heartbeat_managed_storage_blueprint_copy_owner'
        || name === 'settle_managed_storage_blueprint_copy_owner') {
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
    expect(second.assessments[0].documents[0].storage_path)
      .toBe(first.assessments[0].documents[0].storage_path)
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
      storage_bucket: 'test-documents',
      storage_path: expect.stringContaining(`managed-copies/${OPERATION_ID}/`),
    })
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'managed_storage_blueprint_protocol_ready',
      'resolve_managed_storage_blueprint_copy_source',
    ])
  })

  it('returns the deterministic source intent on completed replay for settlement repair', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'managed_storage_blueprint_protocol_ready') {
        return { data: true, error: null }
      }
      if (name === 'resolve_managed_storage_blueprint_copy_source') {
        return {
          data: {
            id: SOURCE_ID,
            storage_bucket: 'test-documents',
            storage_path: 'blueprints/completed-source.pdf',
            status: 'ready',
            content_type: 'application/pdf',
            classroom_id: null,
            course_blueprint_id: BLUEPRINT_ID,
            provisional_owner_id: null,
          },
          error: null,
        }
      }
      if (name === 'settle_managed_storage_blueprint_copy_owner') {
        return { data: true, error: null }
      }
      throw new Error(`Unexpected RPC ${name}`)
    })
    const storage = {
      from: vi.fn(() => ({
        download: vi.fn(),
        upload: vi.fn(),
        getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: path } })),
      })),
    }
    const result = await copyManagedTestDocumentsForBlueprintOperation({
      supabase: { rpc, storage, from: makeOperationLookup('completed') },
      teacherId: USER_ID,
      operationId: OPERATION_ID,
      direction: 'to_classroom',
      sourceCourseBlueprintId: BLUEPRINT_ID,
      assessments: [{
        documents: [{
          id: 'completed-document', title: 'Completed', source: 'upload',
          url: 'https://project.supabase.co/storage/v1/object/public/test-documents/blueprints/completed-source.pdf',
          managed_object_id: SOURCE_ID,
        }],
      }],
    })

    expect(result.provisionalOwnerId).toEqual(expect.any(String))
    await queueBlueprintManagedStorageCopiesBestEffort({
      supabase: { rpc },
      objectIds: result.cleanupObjectIds,
      errorCode: 'blueprint_instantiation_not_adopted',
      provisionalOwnerId: result.provisionalOwnerId,
      operationId: OPERATION_ID,
      teacherId: USER_ID,
      sourceCourseBlueprintId: BLUEPRINT_ID,
      adopted: false,
    })
    expect(rpc).toHaveBeenCalledWith(
      'settle_managed_storage_blueprint_copy_owner',
      expect.objectContaining({
        p_owner_id: result.provisionalOwnerId,
        p_operation_id: OPERATION_ID,
        p_outcome: 'aborted',
      }),
    )
  })

  it('durably aborts a source intent when copying fails before reservation', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'managed_storage_blueprint_protocol_ready'
        || name === 'begin_managed_storage_blueprint_copy_owner'
        || name === 'heartbeat_managed_storage_blueprint_copy_owner'
        || name === 'settle_managed_storage_blueprint_copy_owner') {
        return { data: true, error: null }
      }
      if (name === 'resolve_managed_storage_blueprint_copy_source') {
        return {
          data: {
            id: SOURCE_ID,
            storage_bucket: 'test-documents',
            storage_path: 'blueprints/source.pdf',
            status: 'ready',
            content_type: 'application/pdf',
            classroom_id: null,
            course_blueprint_id: BLUEPRINT_ID,
            provisional_owner_id: null,
          },
          error: null,
        }
      }
      throw new Error(`Unexpected RPC ${name}`)
    })
    const storage = {
      from: vi.fn(() => ({
        download: vi.fn().mockResolvedValue({ data: null, error: { code: 'missing' } }),
        upload: vi.fn(),
        getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: path } })),
      })),
    }

    await expect(copyManagedTestDocumentsForBlueprintOperation({
      supabase: { rpc, storage, from: makeOperationLookup() },
      teacherId: USER_ID,
      operationId: OPERATION_ID,
      direction: 'to_classroom',
      sourceCourseBlueprintId: BLUEPRINT_ID,
      assessments: [{
        documents: [{
          id: 'document', title: 'Source', source: 'upload',
          url: 'https://project.supabase.co/storage/v1/object/public/test-documents/blueprints/source.pdf',
          managed_object_id: SOURCE_ID,
        }],
      }],
    })).rejects.toThrow('managed_storage_blueprint_copy_source_missing')
    expect(rpc).toHaveBeenCalledWith(
      'settle_managed_storage_blueprint_copy_owner',
      expect.objectContaining({ p_outcome: 'aborted' }),
    )
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
      'begin_managed_storage_upload',
    )
  })

  it('heartbeats while one provider call remains stalled beyond the lease', async () => {
    vi.useFakeTimers()
    try {
      let resolveSource!: (value: { data: Blob; error: null }) => void
      const stalledSource = new Promise<{ data: Blob; error: null }>((resolve) => {
        resolveSource = resolve
      })
      let targetPath = ''
      const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name === 'managed_storage_blueprint_protocol_ready'
          || name === 'begin_managed_storage_blueprint_copy_owner'
          || name === 'heartbeat_managed_storage_blueprint_copy_owner') {
          return { data: true, error: null }
        }
        if (name === 'resolve_managed_storage_blueprint_copy_source') {
          return {
            data: {
              id: SOURCE_ID,
              storage_bucket: 'test-documents',
              storage_path: 'blueprints/stalled-source.pdf',
              status: 'ready',
              content_type: 'application/pdf',
              classroom_id: null,
              course_blueprint_id: BLUEPRINT_ID,
              provisional_owner_id: null,
            },
            error: null,
          }
        }
        if (name === 'begin_managed_storage_upload') {
          targetPath = String(args.p_storage_path)
          return {
            data: {
              id: args.p_object_id,
              storage_bucket: 'test-documents',
              storage_path: targetPath,
              status: 'reserved',
            },
            error: null,
          }
        }
        if (name === 'get_managed_storage_object_presence') {
          return { data: { object_exists: false }, error: null }
        }
        if (name === 'verify_managed_storage_upload') {
          return {
            data: {
              id: args.p_object_id,
              storage_bucket: 'test-documents',
              storage_path: targetPath,
              status: 'verified',
            },
            error: null,
          }
        }
        throw new Error(`Unexpected RPC ${name}`)
      })
      const bytes = new Uint8Array([1, 2, 3])
      const storage = {
        from: vi.fn(() => ({
          download: vi.fn((path: string) => path === 'blueprints/stalled-source.pdf'
            ? stalledSource
            : Promise.resolve({ data: new Blob([bytes]), error: null })),
          upload: vi.fn().mockResolvedValue({ data: { path: targetPath }, error: null }),
          getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: path } })),
        })),
      }
      const copy = copyManagedTestDocumentsForBlueprintOperation({
        supabase: { rpc, storage, from: makeOperationLookup() },
        teacherId: USER_ID,
        operationId: OPERATION_ID,
        direction: 'to_classroom',
        sourceCourseBlueprintId: BLUEPRINT_ID,
        assessments: [{
          documents: [{
            id: 'document', title: 'Source', source: 'upload',
            url: 'https://project.supabase.co/storage/v1/object/public/test-documents/blueprints/stalled-source.pdf',
            managed_object_id: SOURCE_ID,
          }],
        }],
      })

      await vi.advanceTimersByTimeAsync(65 * 60 * 1000)
      const heartbeatCalls = () => rpc.mock.calls.filter(
        ([name]) => name === 'heartbeat_managed_storage_blueprint_copy_owner',
      )
      expect(heartbeatCalls().length).toBeGreaterThanOrEqual(13)
      resolveSource({ data: new Blob([bytes]), error: null })
      await expect(copy).resolves.toEqual(expect.objectContaining({
        cleanupObjectIds: [expect.any(String)],
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries a transient heartbeat failure while provider work remains stalled', async () => {
    vi.useFakeTimers()
    try {
      let resolveSource!: (value: { data: Blob; error: null }) => void
      const stalledSource = new Promise<{ data: Blob; error: null }>((resolve) => {
        resolveSource = resolve
      })
      let heartbeatAttempt = 0
      let targetPath = ''
      const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name === 'managed_storage_blueprint_protocol_ready'
          || name === 'begin_managed_storage_blueprint_copy_owner') {
          return { data: true, error: null }
        }
        if (name === 'heartbeat_managed_storage_blueprint_copy_owner') {
          heartbeatAttempt += 1
          return heartbeatAttempt === 2
            ? { data: null, error: { code: 'provider_timeout' } }
            : { data: true, error: null }
        }
        if (name === 'resolve_managed_storage_blueprint_copy_source') {
          return {
            data: {
              id: SOURCE_ID,
              storage_bucket: 'test-documents',
              storage_path: 'blueprints/transient-heartbeat.pdf',
              status: 'ready',
              content_type: 'application/pdf',
              classroom_id: null,
              course_blueprint_id: BLUEPRINT_ID,
              provisional_owner_id: null,
            },
            error: null,
          }
        }
        if (name === 'begin_managed_storage_upload') {
          targetPath = String(args.p_storage_path)
          return {
            data: {
              id: args.p_object_id,
              storage_bucket: 'test-documents',
              storage_path: targetPath,
              status: 'reserved',
            },
            error: null,
          }
        }
        if (name === 'get_managed_storage_object_presence') {
          return { data: { object_exists: false }, error: null }
        }
        if (name === 'verify_managed_storage_upload') {
          return {
            data: {
              id: args.p_object_id,
              storage_bucket: 'test-documents',
              storage_path: targetPath,
              status: 'verified',
            },
            error: null,
          }
        }
        throw new Error(`Unexpected RPC ${name}`)
      })
      const bytes = new Uint8Array([1, 2, 3])
      const storage = {
        from: vi.fn(() => ({
          download: vi.fn((path: string) => path === 'blueprints/transient-heartbeat.pdf'
            ? stalledSource
            : Promise.resolve({ data: new Blob([bytes]), error: null })),
          upload: vi.fn().mockResolvedValue({ data: { path: targetPath }, error: null }),
          getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: path } })),
        })),
      }
      const copy = copyManagedTestDocumentsForBlueprintOperation({
        supabase: { rpc, storage, from: makeOperationLookup() },
        teacherId: USER_ID,
        operationId: OPERATION_ID,
        direction: 'to_classroom',
        sourceCourseBlueprintId: BLUEPRINT_ID,
        assessments: [{
          documents: [{
            id: 'document', title: 'Source', source: 'upload',
            url: 'https://project.supabase.co/storage/v1/object/public/test-documents/blueprints/transient-heartbeat.pdf',
            managed_object_id: SOURCE_ID,
          }],
        }],
      })

      await vi.advanceTimersByTimeAsync(11 * 60 * 1000)
      expect(heartbeatAttempt).toBeGreaterThanOrEqual(3)
      resolveSource({ data: new Blob([bytes]), error: null })
      await expect(copy).resolves.toEqual(expect.objectContaining({
        cleanupObjectIds: [expect.any(String)],
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops before reservation when a heartbeat permanently loses its intent', async () => {
    vi.useFakeTimers()
    try {
      let resolveSource!: (value: { data: Blob; error: null }) => void
      const stalledSource = new Promise<{ data: Blob; error: null }>((resolve) => {
        resolveSource = resolve
      })
      let heartbeatAttempt = 0
      const rpc = vi.fn(async (name: string) => {
        if (name === 'managed_storage_blueprint_protocol_ready'
          || name === 'begin_managed_storage_blueprint_copy_owner'
          || name === 'settle_managed_storage_blueprint_copy_owner') {
          return { data: true, error: null }
        }
        if (name === 'heartbeat_managed_storage_blueprint_copy_owner') {
          heartbeatAttempt += 1
          return heartbeatAttempt === 2
            ? { data: false, error: null }
            : { data: true, error: null }
        }
        if (name === 'resolve_managed_storage_blueprint_copy_source') {
          return {
            data: {
              id: SOURCE_ID,
              storage_bucket: 'test-documents',
              storage_path: 'blueprints/lost-intent.pdf',
              status: 'ready',
              content_type: 'application/pdf',
              classroom_id: null,
              course_blueprint_id: BLUEPRINT_ID,
              provisional_owner_id: null,
            },
            error: null,
          }
        }
        throw new Error(`Unexpected RPC ${name}`)
      })
      const upload = vi.fn()
      const storage = {
        from: vi.fn(() => ({
          download: vi.fn(() => stalledSource),
          upload,
          getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: path } })),
        })),
      }
      const copy = copyManagedTestDocumentsForBlueprintOperation({
        supabase: { rpc, storage, from: makeOperationLookup() },
        teacherId: USER_ID,
        operationId: OPERATION_ID,
        direction: 'to_classroom',
        sourceCourseBlueprintId: BLUEPRINT_ID,
        assessments: [{
          documents: [{
            id: 'document', title: 'Source', source: 'upload',
            url: 'https://project.supabase.co/storage/v1/object/public/test-documents/blueprints/lost-intent.pdf',
            managed_object_id: SOURCE_ID,
          }],
        }],
      })

      await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
      resolveSource({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null })
      await expect(copy).rejects.toThrow('managed_storage_blueprint_copy_heartbeat_failed')
      expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
        'begin_managed_storage_upload',
      )
      expect(upload).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops before read-back when authority is lost during upload reconciliation', async () => {
    vi.useFakeTimers()
    try {
      let resolveRetryPresence!: (value: {
        data: { object_exists: true }; error: null
      }) => void
      let markRetryPresenceStarted!: () => void
      const retryPresenceStarted = new Promise<void>((resolve) => {
        markRetryPresenceStarted = resolve
      })
      const retryPresence = new Promise<{
        data: { object_exists: true }; error: null
      }>((resolve) => {
        resolveRetryPresence = resolve
      })
      let heartbeatAttempt = 0
      let presenceAttempt = 0
      let targetPath = ''
      const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name === 'managed_storage_blueprint_protocol_ready'
          || name === 'begin_managed_storage_blueprint_copy_owner'
          || name === 'settle_managed_storage_blueprint_copy_owner'
          || name === 'queue_managed_storage_cleanup') {
          return { data: true, error: null }
        }
        if (name === 'heartbeat_managed_storage_blueprint_copy_owner') {
          heartbeatAttempt += 1
          return heartbeatAttempt === 2
            ? { data: false, error: null }
            : { data: true, error: null }
        }
        if (name === 'resolve_managed_storage_blueprint_copy_source') {
          return {
            data: {
              id: SOURCE_ID,
              storage_bucket: 'test-documents',
              storage_path: 'blueprints/retry-presence.pdf',
              status: 'ready',
              content_type: 'application/pdf',
              classroom_id: null,
              course_blueprint_id: BLUEPRINT_ID,
              provisional_owner_id: null,
            },
            error: null,
          }
        }
        if (name === 'begin_managed_storage_upload') {
          targetPath = String(args.p_storage_path)
          return {
            data: {
              id: args.p_object_id,
              storage_bucket: 'test-documents',
              storage_path: targetPath,
              status: 'reserved',
            },
            error: null,
          }
        }
        if (name === 'get_managed_storage_object_presence') {
          presenceAttempt += 1
          if (presenceAttempt === 1) {
            return { data: { object_exists: false }, error: null }
          }
          markRetryPresenceStarted()
          return retryPresence
        }
        throw new Error(`Unexpected RPC ${name}`)
      })
      const download = vi.fn(async (path: string) => ({
        data: new Blob([new Uint8Array([1, 2, 3])]),
        error: null,
      }))
      const storage = {
        from: vi.fn(() => ({
          download,
          upload: vi.fn().mockResolvedValue({ data: null, error: { code: 'conflict' } }),
          getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: path } })),
        })),
      }
      const copy = copyManagedTestDocumentsForBlueprintOperation({
        supabase: { rpc, storage, from: makeOperationLookup() },
        teacherId: USER_ID,
        operationId: OPERATION_ID,
        direction: 'to_classroom',
        sourceCourseBlueprintId: BLUEPRINT_ID,
        assessments: [{ documents: [{
          id: 'document', title: 'Source', source: 'upload',
          url: 'https://project.supabase.co/storage/v1/object/public/test-documents/blueprints/retry-presence.pdf',
          managed_object_id: SOURCE_ID,
        }] }],
      })

      await retryPresenceStarted
      await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
      resolveRetryPresence({ data: { object_exists: true }, error: null })
      await expect(copy).rejects.toThrow('managed_storage_blueprint_copy_heartbeat_failed')
      expect(download).toHaveBeenCalledTimes(1)
      expect(download).not.toHaveBeenCalledWith(targetPath)
      expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
        'verify_managed_storage_upload',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops before verification when authority is lost during read-back hashing', async () => {
    vi.useFakeTimers()
    try {
      let resolveReadBack!: (value: ArrayBuffer) => void
      let markReadBackStarted!: () => void
      const readBackStarted = new Promise<void>((resolve) => {
        markReadBackStarted = resolve
      })
      const readBackBytes = new Promise<ArrayBuffer>((resolve) => {
        resolveReadBack = resolve
      })
      let heartbeatAttempt = 0
      let targetPath = ''
      const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name === 'managed_storage_blueprint_protocol_ready'
          || name === 'begin_managed_storage_blueprint_copy_owner'
          || name === 'settle_managed_storage_blueprint_copy_owner'
          || name === 'queue_managed_storage_cleanup') {
          return { data: true, error: null }
        }
        if (name === 'heartbeat_managed_storage_blueprint_copy_owner') {
          heartbeatAttempt += 1
          return heartbeatAttempt === 2
            ? { data: false, error: null }
            : { data: true, error: null }
        }
        if (name === 'resolve_managed_storage_blueprint_copy_source') {
          return {
            data: {
              id: SOURCE_ID,
              storage_bucket: 'test-documents',
              storage_path: 'blueprints/readback-hash.pdf',
              status: 'ready',
              content_type: 'application/pdf',
              classroom_id: null,
              course_blueprint_id: BLUEPRINT_ID,
              provisional_owner_id: null,
            },
            error: null,
          }
        }
        if (name === 'begin_managed_storage_upload') {
          targetPath = String(args.p_storage_path)
          return {
            data: {
              id: args.p_object_id,
              storage_bucket: 'test-documents',
              storage_path: targetPath,
              status: 'reserved',
            },
            error: null,
          }
        }
        if (name === 'get_managed_storage_object_presence') {
          return { data: { object_exists: false }, error: null }
        }
        throw new Error(`Unexpected RPC ${name}`)
      })
      const bytes = new Uint8Array([1, 2, 3])
      const storage = {
        from: vi.fn(() => ({
          download: vi.fn(async (path: string) => path === targetPath
            ? {
                data: {
                  type: 'application/pdf',
                  arrayBuffer: () => {
                    markReadBackStarted()
                    return readBackBytes
                  },
                },
                error: null,
              }
            : { data: new Blob([bytes]), error: null }),
          upload: vi.fn().mockResolvedValue({ data: { path: targetPath }, error: null }),
          getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: path } })),
        })),
      }
      const copy = copyManagedTestDocumentsForBlueprintOperation({
        supabase: { rpc, storage, from: makeOperationLookup() },
        teacherId: USER_ID,
        operationId: OPERATION_ID,
        direction: 'to_classroom',
        sourceCourseBlueprintId: BLUEPRINT_ID,
        assessments: [{ documents: [{
          id: 'document', title: 'Source', source: 'upload',
          url: 'https://project.supabase.co/storage/v1/object/public/test-documents/blueprints/readback-hash.pdf',
          managed_object_id: SOURCE_ID,
        }] }],
      })

      await readBackStarted
      await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
      resolveReadBack(bytes.buffer)
      await expect(copy).rejects.toThrow('managed_storage_blueprint_copy_heartbeat_failed')
      expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
        'verify_managed_storage_upload',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('queues uploaded bytes before closing an aborted source intent', async () => {
    let targetPath = ''
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'managed_storage_blueprint_protocol_ready'
        || name === 'begin_managed_storage_blueprint_copy_owner'
        || name === 'heartbeat_managed_storage_blueprint_copy_owner'
        || name === 'settle_managed_storage_blueprint_copy_owner'
        || name === 'queue_managed_storage_cleanup') {
        return { data: true, error: null }
      }
      if (name === 'resolve_managed_storage_blueprint_copy_source') {
        return {
          data: {
            id: SOURCE_ID,
            storage_bucket: 'test-documents',
            storage_path: 'blueprints/upload-failure.pdf',
            status: 'ready',
            content_type: 'application/pdf',
            classroom_id: null,
            course_blueprint_id: BLUEPRINT_ID,
            provisional_owner_id: null,
          },
          error: null,
        }
      }
      if (name === 'begin_managed_storage_upload') {
        targetPath = String(args.p_storage_path)
        return {
          data: {
            id: args.p_object_id,
            storage_bucket: 'test-documents',
            storage_path: targetPath,
            status: 'reserved',
          },
          error: null,
        }
      }
      if (name === 'get_managed_storage_object_presence') {
        return { data: { object_exists: false }, error: null }
      }
      throw new Error(`Unexpected RPC ${name}`)
    })
    const storage = {
      from: vi.fn(() => ({
        download: vi.fn(async (path: string) => path === targetPath
          ? { data: null, error: { code: 'missing' } }
          : { data: new Blob([new Uint8Array([1, 2, 3])]), error: null }),
        upload: vi.fn().mockResolvedValue({ data: null, error: { code: 'provider' } }),
        getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: path } })),
      })),
    }

    await expect(copyManagedTestDocumentsForBlueprintOperation({
      supabase: { rpc, storage, from: makeOperationLookup() },
      teacherId: USER_ID,
      operationId: OPERATION_ID,
      direction: 'to_classroom',
      sourceCourseBlueprintId: BLUEPRINT_ID,
      assessments: [{
        documents: [{
          id: 'document', title: 'Source', source: 'upload',
          url: 'https://project.supabase.co/storage/v1/object/public/test-documents/blueprints/upload-failure.pdf',
          managed_object_id: SOURCE_ID,
        }],
      }],
    })).rejects.toThrow('managed_storage_blueprint_copy_upload_failed')
    expect(rpc).toHaveBeenCalledWith(
      'queue_managed_storage_cleanup',
      expect.objectContaining({ p_error_code: 'blueprint_storage_copy_failed' }),
    )
    expect(rpc).toHaveBeenCalledWith(
      'settle_managed_storage_blueprint_copy_owner',
      expect.objectContaining({ p_outcome: 'aborted' }),
    )
  })

  it.each([
    { direction: 'to_blueprint' as const },
    { direction: 'to_classroom' as const },
  ])('resolves a registered legacy upload before copying $direction', async ({
    direction,
  }) => {
    const uploaded = new Map<string, Uint8Array>()
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'begin_managed_storage_blueprint_copy_owner'
        && direction === 'to_classroom') {
        return { data: null, error: { code: 'PGRST202', message: 'function missing' } }
      }
      if (name === 'managed_storage_blueprint_protocol_ready'
        || name === 'begin_managed_storage_provisional_owner'
        || name === 'begin_managed_storage_blueprint_copy_owner'
        || name === 'heartbeat_managed_storage_blueprint_copy_owner'
        || name === 'settle_managed_storage_blueprint_copy_owner') {
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
    expect(result.assessments[0].documents[0].storage_path).not.toContain('/legacy/source.pdf')
    expect(result.assessments[0].documents[1]).toMatchObject({
      id: 'legacy-document-b',
      title: 'Legacy B',
      managed_object_id: result.assessments[0].documents[0].managed_object_id,
      storage_bucket: 'test-documents',
      storage_path: result.assessments[0].documents[0].storage_path,
    })
    expect(upload).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith(
      'resolve_managed_storage_blueprint_copy_source',
      expect.objectContaining({
        p_storage_path: 'legacy/source.pdf',
        p_managed_object_id: null,
      }),
    )
    if (direction === 'to_classroom') {
      expect(rpc).toHaveBeenCalledWith(
        'begin_managed_storage_blueprint_copy_owner',
        expect.objectContaining({
          p_source_course_blueprint_id: BLUEPRINT_ID,
          p_operation_id: OPERATION_ID,
          p_created_by_user_id: USER_ID,
        }),
      )
      expect(rpc).toHaveBeenCalledWith(
        'begin_managed_storage_provisional_owner',
        expect.objectContaining({ p_owner_kind: 'classroom_copy' }),
      )
    }
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
        || name === 'begin_managed_storage_provisional_owner'
        || name === 'begin_managed_storage_blueprint_copy_owner'
        || name === 'heartbeat_managed_storage_blueprint_copy_owner'
        || name === 'settle_managed_storage_blueprint_copy_owner') {
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
      storage_bucket: 'test-documents',
      storage_path: expect.stringContaining(`managed-copies/${OPERATION_ID}/`),
    })
    expect(result.assessments[0].documents[0].storage_path).not.toContain('/legacy/unregistered.pdf')
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
