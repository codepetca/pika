import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DEFAULT_CLASSROOM_FEATURE_VISIBILITY } from '@/lib/classroom-feature-visibility'

const mocks = vi.hoisted(() => ({
  assertTeacherOwnsClassroom: vi.fn(),
  getServiceRoleClient: vi.fn(),
  hydrateClassroomRecord: vi.fn((row) => row),
  requireRole: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.getServiceRoleClient }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: mocks.assertTeacherOwnsClassroom,
  hydrateClassroomRecord: mocks.hydrateClassroomRecord,
}))
vi.mock('@/lib/server/classroom-order', () => ({
  getNextTeacherClassroomPosition: vi.fn(),
}))

import { PATCH } from '@/app/api/teacher/classrooms/[id]/route'

const CLASSROOM_ID = '00000000-0000-4000-8000-000000000001'
const TEACHER_ID = '00000000-0000-4000-8000-000000000002'

function request(featureVisibility: unknown) {
  return new NextRequest(`http://localhost/api/teacher/classrooms/${CLASSROOM_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ featureVisibility }),
  })
}

function context() {
  return { params: Promise.resolve({ id: CLASSROOM_ID }) }
}

function mockUpdateResult(result: { data: unknown; error: unknown }) {
  const query = {
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }
  mocks.update.mockReturnValue(query)
  mocks.getServiceRoleClient.mockReturnValue({
    from: vi.fn(() => ({ update: mocks.update })),
  })
}

describe('PATCH /api/teacher/classrooms/[id] feature visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRole.mockResolvedValue({ id: TEACHER_ID, role: 'teacher' })
    mocks.assertTeacherOwnsClassroom.mockResolvedValue({
      ok: true,
      classroom: {
        id: CLASSROOM_ID,
        teacher_id: TEACHER_ID,
        archived_at: null,
        actual_site_slug: null,
        actual_site_published: false,
      },
    })
  })

  it('persists the complete validated visibility contract', async () => {
    const featureVisibility = {
      ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
      tests: false,
      attendance: false,
    }
    mockUpdateResult({
      data: { id: CLASSROOM_ID, feature_visibility: featureVisibility },
      error: null,
    })

    const response = await PATCH(request(featureVisibility), context())

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ feature_visibility: featureVisibility })
    await expect(response.json()).resolves.toEqual({
      classroom: { id: CLASSROOM_ID, feature_visibility: featureVisibility },
    })
  })

  it('rejects partial feature payloads at the API boundary', async () => {
    const response = await PATCH(request({ tests: false }), context())

    expect(response.status).toBe(400)
    expect(mocks.assertTeacherOwnsClassroom).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('keeps archived classrooms read-only', async () => {
    mocks.assertTeacherOwnsClassroom.mockResolvedValueOnce({
      ok: true,
      classroom: {
        id: CLASSROOM_ID,
        teacher_id: TEACHER_ID,
        archived_at: '2026-08-20T00:00:00.000Z',
        actual_site_slug: null,
        actual_site_published: false,
      },
    })

    const response = await PATCH(request(DEFAULT_CLASSROOM_FEATURE_VISIBILITY), context())

    expect(response.status).toBe(403)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('reports the migration compatibility window explicitly', async () => {
    mockUpdateResult({
      data: null,
      error: {
        code: 'PGRST204',
        message: "Could not find the 'feature_visibility' column",
      },
    })

    const response = await PATCH(request(DEFAULT_CLASSROOM_FEATURE_VISIBILITY), context())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Classroom feature controls are not available until migration 128 is applied',
    })
  })
})
