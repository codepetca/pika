import { beforeEach, describe, expect, it, vi } from 'vitest'
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
      created_by_user_id: 'student-1',
      data_subject_user_id: 'student-1',
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
