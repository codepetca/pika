import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/storage/submission-images/route'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))

import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'

const OBJECT_ID = '10000000-0000-4000-8000-000000000001'
const DOC_ID = '20000000-0000-4000-8000-000000000001'
const ASSIGNMENT_ID = '30000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '40000000-0000-4000-8000-000000000001'

function queryResult(data: unknown, error: unknown = null) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data, error })),
  }
  return query
}

function createSupabase(options: {
  studentId?: string
  classroomTeacherId?: string
  status?: string
  managedObject?: unknown
  bucketPublic?: boolean
  dataSubjectUserId?: string
  createdByUserId?: string
  contextualResult?: unknown
} = {}) {
  const createSignedUrl = vi.fn(async () => ({
    data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/submission-images/work.png?token=short-lived' },
    error: null,
  }))
  const managedObject = {
      id: OBJECT_ID,
      storage_path: 'classrooms/class/students/student/work.png',
      status: options.status || 'ready',
      purpose: 'student_inline_image',
      classroom_id: CLASSROOM_ID,
      created_by_user_id: options.createdByUserId || 'student-1',
      data_subject_user_id: options.dataSubjectUserId || 'student-1',
      resource_type: 'assignment_doc',
      resource_id: DOC_ID,
      content_type: 'image/png',
  }
  const rows: Record<string, unknown> = {
    managed_storage_objects: options.managedObject === undefined
      ? managedObject
      : options.managedObject,
    assignment_docs: {
      id: DOC_ID,
      student_id: options.studentId || 'student-1',
      assignment_id: ASSIGNMENT_ID,
    },
    assignments: { classroom_id: CLASSROOM_ID },
    classrooms: { teacher_id: options.classroomTeacherId || 'teacher-1' },
  }
  return {
    client: {
      from: vi.fn((table: string) => queryResult(rows[table])),
      rpc: vi.fn(async () => ({
        data: options.contextualResult === undefined ? {
          ok: true,
          classroom_id: CLASSROOM_ID,
          assignment_id: ASSIGNMENT_ID,
          assignment_doc_id: DOC_ID,
          managed_object_id: OBJECT_ID,
        } : options.contextualResult,
        error: null,
      })),
      storage: {
        getBucket: vi.fn(async () => ({
          data: { id: 'submission-images', public: options.bucketPublic ?? false },
          error: null,
        })),
        from: vi.fn(() => ({
          createSignedUrl,
          info: vi.fn(async () => ({
            data: { size: 12, contentType: 'image/png' }, error: null,
          })),
          getPublicUrl: vi.fn(() => ({
            data: {
              publicUrl: 'https://project.supabase.co/storage/v1/object/public/submission-images/legacy.png',
            },
          })),
        })),
      },
    },
    createSignedUrl,
  }
}

describe('GET /api/storage/submission-images', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllEnvs())

  it.each(['object_id=invalid', 'path=legacy.png'])('rejects malformed shared config before query, lookup or public compatibility (%s)', async (query) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'bad')
    vi.mocked(requireAuth).mockResolvedValue({ id: '50000000-0000-4000-8000-000000000001', role: 'student' } as any)
    const { client } = createSupabase({ managedObject: null, bucketPublic: true })
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)
    expect((await GET(new NextRequest(`http://localhost/api/storage/submission-images?${query}`))).status).toBe(503)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(client.from).not.toHaveBeenCalled()
    expect(client.storage.getBucket).not.toHaveBeenCalled()
    const error = new Error('Authentication required')
    error.name = 'AuthenticationError'
    vi.mocked(requireAuth).mockRejectedValueOnce(error)
    expect((await GET(new NextRequest(`http://localhost/api/storage/submission-images?${query}`))).status).toBe(401)
  })

  it.each(['teacher', 'student'] as const)('reads through the current-access RPC for a shared admitted %s', async (role) => {
    const actorId = '50000000-0000-4000-8000-000000000001'
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_PAIRS', 'broken')
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role } as any)
    const { client } = createSupabase()
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)
    expect((await GET(new NextRequest(`http://localhost/api/storage/submission-images?object_id=${OBJECT_ID}`))).status).toBe(302)
    expect(client.rpc).toHaveBeenCalledWith('read_assignment_inline_image_for_context_v1', expect.objectContaining({ p_actor_id: actorId, p_managed_object_id: OBJECT_ID }))
    expect(client.from).not.toHaveBeenCalledWith('classrooms')
  })

  it('never falls back to legacy owner access or delivery after contextual denial', async () => {
    const actorId = '50000000-0000-4000-8000-000000000001'
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'teacher' } as any)
    const { client, createSignedUrl } = createSupabase({ classroomTeacherId: actorId, contextualResult: { ok: false, status: 403, error: 'Forbidden' } })
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)
    expect((await GET(new NextRequest(`http://localhost/api/storage/submission-images?object_id=${OBJECT_ID}`))).status).toBe(404)
    expect(createSignedUrl).not.toHaveBeenCalled()
    expect(client.from).not.toHaveBeenCalledWith('classrooms')
  })

  it('delivers an owned student image with private headers', async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: 'student-1', email: 'student@example.com', role: 'student',
    } as any)
    const { client, createSignedUrl } = createSupabase()
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)

    const response = await GET(new NextRequest(
      `http://localhost:3000/api/storage/submission-images?object_id=${OBJECT_ID}`,
    ))

    expect(response.status).toBe(302)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('location')).toContain('token=short-lived')
    expect(createSignedUrl).toHaveBeenCalledWith(
      'classrooms/class/students/student/work.png',
      60,
    )
  })

  it('does not reveal another student’s image', async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: 'student-2', email: 'other@example.com', role: 'student',
    } as any)
    const { client, createSignedUrl } = createSupabase()
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)

    const response = await GET(new NextRequest(
      `http://localhost:3000/api/storage/submission-images?object_id=${OBJECT_ID}`,
    ))
    expect(response.status).toBe(404)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('delivers only to the teacher who owns the Classroom', async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: 'teacher-2', email: 'teacher@example.com', role: 'teacher',
    } as any)
    const { client, createSignedUrl } = createSupabase({ classroomTeacherId: 'teacher-1' })
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)

    const response = await GET(new NextRequest(
      `http://localhost:3000/api/storage/submission-images?object_id=${OBJECT_ID}`,
    ))
    expect(response.status).toBe(404)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('lets a teacher-valued exact member read only their own visible document image', async () => {
    const memberId = '50000000-0000-4000-8000-000000000001'
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_PAIRS', JSON.stringify([{
      userId: memberId, classroomId: CLASSROOM_ID,
    }]))
    vi.mocked(requireAuth).mockResolvedValue({
      id: memberId, email: 'member@example.com', role: 'teacher',
    } as any)
    const { client, createSignedUrl } = createSupabase({
      studentId: memberId, dataSubjectUserId: memberId, createdByUserId: memberId,
    })
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)

    const response = await GET(new NextRequest(
      `http://localhost:3000/api/storage/submission-images?object_id=${OBJECT_ID}`,
    ))

    expect(response.status).toBe(302)
    expect(client.rpc).toHaveBeenCalledWith('read_assignment_inline_image_for_context_v1', expect.objectContaining({
      p_actor_id: memberId, p_assignment_doc_id: DOC_ID, p_managed_object_id: OBJECT_ID,
    }))
    expect(createSignedUrl).toHaveBeenCalled()
  })

  it('lets a student-valued exact owner inspect a ready image', async () => {
    const ownerId = '50000000-0000-4000-8000-000000000002'
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_PAIRS', JSON.stringify([{
      userId: ownerId, classroomId: CLASSROOM_ID,
    }]))
    vi.mocked(requireAuth).mockResolvedValue({
      id: ownerId, email: 'owner@example.com', role: 'student',
    } as any)
    const { client } = createSupabase({ classroomTeacherId: ownerId, status: 'ready' })
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)

    expect((await GET(new NextRequest(
      `http://localhost:3000/api/storage/submission-images?object_id=${OBJECT_ID}`,
    ))).status).toBe(302)
  })

  it('fails closed when contextual RPC evidence substitutes a managed object', async () => {
    const memberId = '50000000-0000-4000-8000-000000000003'
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_PAIRS', JSON.stringify([{
      userId: memberId, classroomId: CLASSROOM_ID,
    }]))
    vi.mocked(requireAuth).mockResolvedValue({ id: memberId, email: 'member@example.com', role: 'teacher' } as any)
    const { client, createSignedUrl } = createSupabase({
      studentId: memberId, dataSubjectUserId: memberId, createdByUserId: memberId,
      contextualResult: {
        ok: true, classroom_id: CLASSROOM_ID, assignment_id: ASSIGNMENT_ID,
        assignment_doc_id: DOC_ID, managed_object_id: '50000000-0000-4000-8000-000000000004',
      },
    })
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)

    expect((await GET(new NextRequest(
      `http://localhost:3000/api/storage/submission-images?object_id=${OBJECT_ID}`,
    ))).status).toBe(503)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('fails closed before public-compatibility delivery when the enabled cohort is malformed', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_PAIRS', 'not-json')
    vi.mocked(requireAuth).mockResolvedValue({ id: 'student-1', email: 'student@example.com', role: 'student' } as any)
    const { client, createSignedUrl } = createSupabase({ managedObject: null, bucketPublic: true })
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)

    expect((await GET(new NextRequest(
      'http://localhost:3000/api/storage/submission-images?path=student-1%2Flegacy.png',
    ))).status).toBe(503)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('rejects requests without exactly one validated identity', async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: 'student-1', email: 'student@example.com', role: 'student',
    } as any)
    const { client } = createSupabase()
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)

    const response = await GET(new NextRequest(
      'http://localhost:3000/api/storage/submission-images',
    ))
    expect(response.status).toBe(400)
  })

  it('preserves an unregistered legacy image only while the bucket is public', async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: 'student-1', email: 'student@example.com', role: 'student',
    } as any)
    const { client } = createSupabase({ managedObject: null, bucketPublic: true })
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)

    const response = await GET(new NextRequest(
      'http://localhost:3000/api/storage/submission-images?path=student-1%2Flegacy.png',
    ))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('/object/public/submission-images/')
  })

  it('fails closed for an unregistered image after the bucket is private', async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: 'student-1', email: 'student@example.com', role: 'student',
    } as any)
    const { client, createSignedUrl } = createSupabase({ managedObject: null })
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)

    const response = await GET(new NextRequest(
      'http://localhost:3000/api/storage/submission-images?path=student-1%2Flegacy.png',
    ))

    expect(response.status).toBe(404)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })
})
