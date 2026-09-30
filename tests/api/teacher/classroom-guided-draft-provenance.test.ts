import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/teacher/classrooms/[id]/authoring-drafts/provenance/route'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), ownsClassroom: vi.fn(), from: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherOwnsClassroom: mocks.ownsClassroom }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from: mocks.from }) }))

const artifactId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const context = { params: Promise.resolve({ id: 'classroom-1' }) }

function request(target: string, id = artifactId) {
  return new NextRequest(
    `http://localhost/api/teacher/classrooms/classroom-1/authoring-drafts/provenance?target=${target}&artifact_id=${id}`,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue({ id: 'teacher-1' })
  mocks.ownsClassroom.mockResolvedValue({ ok: true, classroom: { id: 'classroom-1' } })
  const chain = {
    select: vi.fn(() => chain), eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({
      data: { source_blueprint_version_number: 3, unit_label: 'Unit 1' }, error: null,
    })),
  }
  mocks.from.mockReturnValue(chain)
})

describe('teacher-only classroom guided draft source', () => {
  it('returns compact private source after owner and exact artifact scope checks', async () => {
    const response = await GET(request('tests'), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ provenance: {
      source_blueprint_version_number: 3, unit_label: 'Unit 1', target: 'tests',
    } })
    expect(mocks.ownsClassroom).toHaveBeenCalledWith('teacher-1', 'classroom-1', expect.any(Object))
    const query = mocks.from.mock.results[0].value
    expect(query.eq).toHaveBeenCalledWith('classroom_id', 'classroom-1')
    expect(query.eq).toHaveBeenCalledWith('test_id', artifactId)
  })

  it('rejects a different teacher before private sidecar reads', async () => {
    mocks.ownsClassroom.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const response = await GET(request('assignments'), context)
    expect(response.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('validates exact target and artifact id', async () => {
    const response = await GET(request('surveys', 'not-a-uuid'), context)
    expect(response.status).toBe(400)
    expect(mocks.ownsClassroom).not.toHaveBeenCalled()
  })
})
