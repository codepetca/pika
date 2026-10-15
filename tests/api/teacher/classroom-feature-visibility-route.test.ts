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

  it.each([true, false])('saves the student zero-weight setting as %s', async hide => {
    const featureVisibility = { ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, gradebook_hide_zero_weight_student: hide }
    mockUpdateResult({ data: { id: CLASSROOM_ID, feature_visibility: featureVisibility }, error: null })
    expect((await PATCH(request(featureVisibility), context())).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ feature_visibility: featureVisibility })
  })

  it('preserves the student setting when an older client omits it', async () => {
    const visibility = { ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, gradebook_hide_zero_weight_student: true }
    mocks.assertTeacherOwnsClassroom.mockResolvedValue({ ok: true, classroom: { id: CLASSROOM_ID, teacher_id: TEACHER_ID, feature_visibility: visibility } })
    mockUpdateResult({ data: { id: CLASSROOM_ID, feature_visibility: visibility }, error: null })
    const { gradebook_hide_zero_weight_student: _setting, ...oldClient } = visibility
    expect((await PATCH(request(oldClient), context())).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ feature_visibility: visibility })
  })

  it('rejects a nonboolean student setting', async () => {
    expect((await PATCH(request({ ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, gradebook_hide_zero_weight_student: 'true' }), context())).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it.each([true, false])('saves shared zero-weight compaction as %s', async compact => {
    const visibility = { ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, gradebook_compact_zero_weight_assessments: compact }
    mockUpdateResult({ data: { id: CLASSROOM_ID, feature_visibility: visibility }, error: null })
    expect((await PATCH(request(visibility), context())).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ feature_visibility: visibility })
  })

  it.each([true, false])('preserves compaction %s and the legacy setting when older clients omit both', async compact => {
    const visibility = { ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, gradebook_hide_zero_weight_student: true, gradebook_compact_zero_weight_assessments: compact }
    mocks.assertTeacherOwnsClassroom.mockResolvedValue({ ok: true, classroom: { id: CLASSROOM_ID, teacher_id: TEACHER_ID, feature_visibility: visibility } })
    mockUpdateResult({ data: { id: CLASSROOM_ID, feature_visibility: visibility }, error: null })
    const { gradebook_hide_zero_weight_student: _legacy, gradebook_compact_zero_weight_assessments: _compact, ...older } = visibility
    expect((await PATCH(request(older), context())).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ feature_visibility: visibility })
  })

  it('defaults compaction on when both the persisted setting and older client setting are absent', async () => {
    const { gradebook_compact_zero_weight_assessments: _compact, ...older } = DEFAULT_CLASSROOM_FEATURE_VISIBILITY
    mockUpdateResult({ data: { id: CLASSROOM_ID, feature_visibility: DEFAULT_CLASSROOM_FEATURE_VISIBILITY }, error: null })
    expect((await PATCH(request(older), context())).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ feature_visibility: DEFAULT_CLASSROOM_FEATURE_VISIBILITY })
  })

  it.each(['true', null, 0])('rejects malformed compaction %#', async value => {
    expect((await PATCH(request({ ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, gradebook_compact_zero_weight_assessments: value }), context())).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
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
