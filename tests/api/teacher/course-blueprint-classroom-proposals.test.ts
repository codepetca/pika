import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/course-blueprints/[id]/proposals/classrooms/route'
import { COURSE_BLUEPRINT_AUTHORING_IMAGE_ERROR } from '@/lib/course-blueprint-package-storage-policy'
import { makeQueryBuilder } from '../../support/supabase'

const mocks = vi.hoisted(() => ({ detail: vi.fn(), source: vi.fn(), version: vi.fn(), submit: vi.fn(), base: vi.fn(), plan: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher' })) }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/server/course-blueprints', () => ({ getCourseBlueprintDetail: (...args: unknown[]) => mocks.detail(...args) }))
vi.mock('@/lib/server/classroom-blueprint-source', () => ({ loadClassroomBlueprintSource: (...args: unknown[]) => mocks.source(...args) }))
vi.mock('@/lib/server/course-blueprint-versions', () => ({ saveCourseBlueprintVersion: (...args: unknown[]) => mocks.version(...args) }))
vi.mock('@/lib/server/course-blueprint-proposals', () => ({
  countUntrackedClassroomBlueprintArtifacts: () => 0,
  buildClassroomCourseBlueprintSnapshot: (...args: unknown[]) => mocks.base(...args),
  submitClassroomBlueprintProposal: (...args: unknown[]) => mocks.submit(...args),
}))
vi.mock('@/lib/server/course-blueprint-operations', () => ({
  buildClassroomBlueprintUpdateWritePlan: (...args: unknown[]) => mocks.plan(...args),
  resolveBlueprintOperationId: () => 'c2910000-0000-4000-8000-000000000099',
}))

const blueprintId = 'c2910000-0000-4000-8000-000000000010'
const classroomId = 'c2910000-0000-4000-8000-000000000011'
const image = '![Private](/api/storage/authoring-images?object_id=c2910000-0000-4000-8000-000000000101)'
const incoming = { overview_markdown: 'Clean incoming content', linked_classrooms: [{ id: classroomId }], content_revision: 1 }
const request = () => POST(new NextRequest(`http://localhost/api/teacher/course-blueprints/${blueprintId}/proposals/classrooms`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classroom_id: classroomId }),
}), { params: Promise.resolve({ id: blueprintId }) } as any)

describe('classroom Blueprint proposal image admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detail.mockResolvedValue({ detail: incoming })
    mocks.source.mockResolvedValue({ ok: true, source: { classroom: { start_date: '2026-09-01', blueprint_source_revision: 7 }, assignments: [{ instructions_markdown: image }] } })
    mocks.from.mockReturnValue(makeQueryBuilder({ data: [{ date: '2026-09-01' }], error: null }))
    mocks.version.mockResolvedValue({ ok: true, version: { id: 'version' }, snapshot: { sections: { overview_markdown: 'Clean incoming content' } } })
    mocks.base.mockReturnValue({ sections: { overview_markdown: image } })
    mocks.plan.mockReturnValue({ sections: { overview_markdown: 'Clean incoming content' } })
    mocks.submit.mockResolvedValue({ ok: true, proposal: { status: 'ready' } })
  })

  it.each([image, image.replace('](/', '](https://pika.example/')])('rejects protected incoming references before version or proposal writes: %s', async content => {
    mocks.detail.mockResolvedValue({ detail: { ...incoming, overview_markdown: content } })
    const response = await request()
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: COURSE_BLUEPRINT_AUTHORING_IMAGE_ERROR })
    expect(mocks.version).not.toHaveBeenCalled()
    expect(mocks.plan).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('allows a clean incoming candidate when the target classroom/base retains its own images', async () => {
    const response = await request()
    expect(response.status).toBe(201)
    expect(mocks.version).toHaveBeenCalledOnce()
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      base: { sections: { overview_markdown: image } },
      candidate: { sections: { overview_markdown: 'Clean incoming content' } },
    }))
  })
})
