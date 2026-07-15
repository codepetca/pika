import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getServiceRoleClient: vi.fn(() => ({ client: true })),
  isRestoreAllowed: vi.fn(() => true),
  requireRole: vi.fn(),
  resolveBudget: vi.fn(() => 524288000),
  restoreClassroomArchive: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.getServiceRoleClient }))
vi.mock('@/lib/server/classroom-archive-restore-operations', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/lib/server/classroom-archive-restore-operations')
  >()
  return {
    ...actual,
    isClassroomArchiveRestoreAllowed: mocks.isRestoreAllowed,
    resolveClassroomArchiveRestoreDatabaseBudget: mocks.resolveBudget,
    restoreClassroomArchive: mocks.restoreClassroomArchive,
  }
})

import { POST } from '@/app/api/teacher/classrooms/[id]/archives/[archiveId]/restore/route'

const CLASSROOM_ID = '00000000-0000-4000-8000-000000000001'
const ARCHIVE_ID = '00000000-0000-4000-8000-000000000002'
const OPERATION_ID = '00000000-0000-4000-8000-000000000003'
const TEACHER_ID = '00000000-0000-4000-8000-000000000004'

function context() {
  return { params: Promise.resolve({ id: CLASSROOM_ID, archiveId: ARCHIVE_ID }) }
}

describe('POST /api/teacher/classrooms/[id]/archives/[archiveId]/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
    mocks.requireRole.mockResolvedValue({ id: TEACHER_ID, role: 'teacher' })
    mocks.isRestoreAllowed.mockReturnValue(true)
    mocks.resolveBudget.mockReturnValue(524288000)
    mocks.restoreClassroomArchive.mockResolvedValue({
      ok: true,
      status: 201,
      operation_id: OPERATION_ID,
      archive_id: ARCHIVE_ID,
      replayed: false,
      resource_counts: { classrooms: 1 },
      verification: { referential_integrity_verified: true },
    })
  })

  it('starts an allowlisted restore with an explicit capacity budget', async () => {
    const request = new NextRequest(
      `http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/archives/${ARCHIVE_ID}/restore`,
      { method: 'POST', headers: { 'Idempotency-Key': OPERATION_ID } },
    )
    const response = await POST(request, context())
    expect(response.status).toBe(201)
    expect(mocks.restoreClassroomArchive).toHaveBeenCalledWith({
      supabase: { client: true },
      operationId: OPERATION_ID,
      archiveId: ARCHIVE_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      databaseBudgetBytes: 524288000,
      supabaseUrl: 'https://project.supabase.co',
    })
  })

  it('fails before database access when restore is not enabled for the teacher', async () => {
    mocks.isRestoreAllowed.mockReturnValue(false)
    const request = new NextRequest(
      `http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/archives/${ARCHIVE_ID}/restore`,
      { method: 'POST', headers: { 'Idempotency-Key': OPERATION_ID } },
    )
    const response = await POST(request, context())
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error_code: 'classroom_archive_restore_not_enabled',
    }))
    expect(mocks.resolveBudget).not.toHaveBeenCalled()
    expect(mocks.getServiceRoleClient).not.toHaveBeenCalled()
  })

  it('fails closed when the restore database budget is unavailable', async () => {
    mocks.resolveBudget.mockImplementation(() => {
      throw new Error('missing')
    })
    const request = new NextRequest(
      `http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/archives/${ARCHIVE_ID}/restore`,
      { method: 'POST', headers: { 'Idempotency-Key': OPERATION_ID } },
    )
    const response = await POST(request, context())
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error_code: 'classroom_archive_restore_budget_unavailable',
    }))
    expect(mocks.getServiceRoleClient).not.toHaveBeenCalled()
  })

  it('rejects unexpected request fields before restore', async () => {
    const request = new NextRequest(
      `http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/archives/${ARCHIVE_ID}/restore`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': OPERATION_ID,
        },
        body: JSON.stringify({ force: true }),
      },
    )
    expect((await POST(request, context())).status).toBe(400)
    expect(mocks.restoreClassroomArchive).not.toHaveBeenCalled()
  })
})
