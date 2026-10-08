import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE, PATCH, POST } from '@/app/api/upload-image/route'
import { IMAGE_MAX_SIZE } from '@/lib/image-upload'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))

import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'

const assignmentDocId = '10000000-0000-4000-8000-000000000001'
const assignmentId = '20000000-0000-4000-8000-000000000001'
const classroomId = '30000000-0000-4000-8000-000000000001'
const objectId = '40000000-0000-4000-8000-000000000001'

function request(method: string, body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/upload-image', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function reservationBody(overrides: Record<string, unknown> = {}) {
  return {
    assignment_doc_id: assignmentDocId,
    file_name: 'work.png',
    content_type: 'image/png',
    byte_size: 1024,
    ...overrides,
  }
}

describe('/api/upload-image direct storage flow', () => {
  const createSignedUploadUrl = vi.fn()
  const info = vi.fn()
  const rpc = vi.fn()
  let managedObject: Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(objectId)
    vi.mocked(requireAuth).mockResolvedValue({
      id: 'student-1',
      email: 'student@example.com',
      role: 'student',
    } as Awaited<ReturnType<typeof requireAuth>>)
    managedObject = {
      id: objectId,
      storage_bucket: 'submission-images',
      storage_path: `${classroomId}/students/student-1/${objectId}.png`,
      status: 'reserved',
      purpose: 'student_inline_image',
      classroom_id: classroomId,
      created_by_user_id: 'student-1',
      data_subject_user_id: 'student-1',
      resource_type: 'assignment_doc',
      resource_id: assignmentDocId,
      content_type: 'image/png',
      byte_size: 1024,
    }
    createSignedUploadUrl.mockResolvedValue({
      data: {
        token: 'signed-upload-token',
        signedUrl: 'https://project.supabase.co/storage/v1/object/upload/sign/submission-images/work.png?token=signed-upload-token',
      },
      error: null,
    })
    info.mockResolvedValue({
      data: { size: 1024, contentType: 'image/png' },
      error: null,
    })
    rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'reserve_assignment_inline_image_for_member_v1') {
        return { data: {
          ok: true,
          classroom_id: classroomId,
          assignment_id: assignmentId,
          assignment_doc_id: assignmentDocId,
          managed_object_id: args.p_object_id,
        }, error: null }
      }
      if (name === 'finalize_assignment_inline_image_for_member_v1') {
        return { data: {
          ok: true,
          classroom_id: classroomId,
          assignment_id: assignmentId,
          assignment_doc_id: assignmentDocId,
          managed_object_id: args.p_managed_object_id,
        }, error: null }
      }
      if (name === 'begin_managed_storage_upload') {
        managedObject = {
          ...managedObject,
          id: args.p_object_id,
          storage_path: args.p_storage_path,
          content_type: args.p_content_type,
          byte_size: args.p_byte_size,
        }
        return { data: managedObject, error: null }
      }
      if (name === 'verify_managed_storage_upload') {
        return { data: { ...managedObject, status: 'verified' }, error: null }
      }
      return { data: true, error: null }
    })

    vi.mocked(getServiceRoleClient).mockReturnValue({
      rpc,
      from: vi.fn((table: string) => {
        const query: any = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          maybeSingle: vi.fn(async () => ({
            data: table === 'assignment_docs'
              ? { id: assignmentDocId, student_id: 'student-1', assignment_id: assignmentId }
              : table === 'assignments'
                ? { id: assignmentId, classroom_id: classroomId }
                : managedObject,
            error: null,
          })),
        }
        return query
      }),
      storage: {
        from: vi.fn(() => ({ createSignedUploadUrl, info })),
      },
    } as unknown as ReturnType<typeof getServiceRoleClient>)
  })

  afterEach(() => vi.unstubAllEnvs())

  it.each([['POST', POST], ['PATCH', PATCH], ['DELETE', DELETE]] as const)(
    'validates shared admission after auth and before %s body or discovery',
    async (method, handler) => {
      vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'malformed')
      const input = request(method, {})
      const json = vi.spyOn(input, 'json')
      expect((await handler(input)).status).toBe(503)
      expect(json).not.toHaveBeenCalled()
      expect(getServiceRoleClient).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()
      const authError = new Error('Not authenticated')
      authError.name = 'AuthenticationError'
      vi.mocked(requireAuth).mockRejectedValueOnce(authError)
      expect((await handler(input)).status).toBe(401)
      expect(json).not.toHaveBeenCalled()
    },
  )

  it.each(['teacher', 'student'] as const)('uses contextual image reserve and finalize RPCs for a shared admitted %s', async (role) => {
    const actorId = '50000000-0000-4000-8000-000000000001'
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_PAIRS', 'broken')
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, email: 'member@example.com', role } as any)
    managedObject = { ...managedObject, created_by_user_id: actorId, data_subject_user_id: actorId }
    expect((await POST(request('POST', reservationBody()))).status).toBe(200)
    expect((await PATCH(request('PATCH', { assignment_doc_id: assignmentDocId, managed_object_id: objectId }))).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('reserve_assignment_inline_image_for_member_v1', expect.objectContaining({ p_actor_id: actorId }))
    expect(rpc).toHaveBeenCalledWith('finalize_assignment_inline_image_for_member_v1', expect.objectContaining({ p_actor_id: actorId }))
    expect(rpc).not.toHaveBeenCalledWith('begin_managed_storage_upload', expect.anything())
    expect(rpc).not.toHaveBeenCalledWith('verify_managed_storage_upload', expect.anything())
  })

  it('does not reserve or sign after the contextual transaction denies the admitted actor', async () => {
    const actorId = '50000000-0000-4000-8000-000000000001'
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, email: 'member@example.com', role: 'teacher' } as any)
    rpc.mockResolvedValue({ data: { ok: false, status: 403, error: 'Forbidden' }, error: null })
    expect((await POST(request('POST', reservationBody()))).status).toBe(403)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalledWith('begin_managed_storage_upload', expect.anything())
  })

  it('rejects unauthenticated and identity-less sessions', async () => {
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    vi.mocked(requireAuth).mockRejectedValueOnce(authError)
    expect((await POST(request('POST', reservationBody()))).status).toBe(401)

    vi.mocked(requireAuth).mockResolvedValueOnce({ role: 'student' } as any)
    expect((await POST(request('POST', reservationBody()))).status).toBe(401)
  })

  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])(
    'reserves a direct %s upload without receiving file bytes',
    async (contentType) => {
      const response = await POST(request('POST', reservationBody({
        content_type: contentType,
        file_name: `work.${contentType.split('/')[1]}`,
      })))
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual(expect.objectContaining({
        bucket: 'submission-images',
        upload_url: expect.stringContaining('token=signed-upload-token'),
        managed_object_id: objectId,
      }))
      expect(data.storage_path).toContain('/students/student-1/')
      expect(createSignedUploadUrl).toHaveBeenCalledWith(data.storage_path, { upsert: false })
    },
  )

  it('rejects invalid MIME types and oversized metadata before reservation', async () => {
    expect((await POST(request('POST', reservationBody({
      content_type: 'application/pdf',
    })))).status).toBe(400)
    expect((await POST(request('POST', reservationBody({
      byte_size: IMAGE_MAX_SIZE + 1,
    })))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('lets a teacher-valued exact member reserve through the contextual transaction', async () => {
    const contextualMemberId = '50000000-0000-4000-8000-000000000001'
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_PAIRS', JSON.stringify([{
      userId: contextualMemberId, classroomId,
    }]))
    vi.mocked(requireAuth).mockResolvedValue({
      id: contextualMemberId, email: 'member@example.com', role: 'teacher',
    } as Awaited<ReturnType<typeof requireAuth>>)

    const response = await POST(request('POST', reservationBody()))

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('reserve_assignment_inline_image_for_member_v1', expect.objectContaining({
      p_actor_id: contextualMemberId, p_assignment_doc_id: assignmentDocId,
      p_expected_classroom_id: classroomId,
    }))
    expect(rpc).not.toHaveBeenCalledWith('begin_managed_storage_upload', expect.anything())
  })

  it('finalizes only an exact uploaded object whose size and MIME match', async () => {
    const response = await PATCH(request('PATCH', {
      assignment_doc_id: assignmentDocId,
      managed_object_id: objectId,
    }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(info).toHaveBeenCalledWith(managedObject.storage_path)
    expect(rpc).toHaveBeenCalledWith('verify_managed_storage_upload', {
      p_object_id: objectId,
      p_content_sha256: null,
    })
    expect(data.url).toBe(`/api/storage/submission-images?object_id=${objectId}`)
  })

  it('fails finalization and queues cleanup when uploaded metadata differs', async () => {
    info.mockResolvedValueOnce({
      data: { size: 2048, contentType: 'image/png' },
      error: null,
    })
    const response = await PATCH(request('PATCH', {
      assignment_doc_id: assignmentDocId,
      managed_object_id: objectId,
    }))

    expect(response.status).toBe(400)
    expect(rpc).toHaveBeenCalledWith('queue_managed_storage_cleanup', expect.objectContaining({
      p_object_id: objectId,
    }))
  })

  it('queues an owned abandoned reservation without revealing whether another exists', async () => {
    const response = await DELETE(request('DELETE', { managed_object_id: objectId }))
    expect(response.status).toBe(204)
    expect(rpc).toHaveBeenCalledWith('queue_managed_storage_cleanup', expect.objectContaining({
      p_object_id: objectId,
    }))
  })

  it('queues an owned finalized image that was not inserted into student work', async () => {
    managedObject = { ...managedObject, status: 'verified' }

    const response = await DELETE(request('DELETE', { managed_object_id: objectId }))

    expect(response.status).toBe(204)
    expect(rpc).toHaveBeenCalledWith('queue_managed_storage_cleanup', {
      p_error_code: 'submission_image_not_inserted',
      p_object_id: objectId,
    })
  })
})
