import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adoptClassroomGuidance, previewClassroomGuidanceAdoption } from '@/lib/server/classroom-guidance-adoption'

const mocks = vi.hoisted(() => ({ context: vi.fn(), detail: vi.fn(), save: vi.fn(), rpc: vi.fn(), permission: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherCanMutateClassroom: mocks.permission }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('@/lib/server/classroom-authoring-guidance', () => ({ getClassroomAuthoringGuidance: mocks.context }))
vi.mock('@/lib/server/course-blueprints', () => ({ getCourseBlueprintDetail: mocks.detail }))
vi.mock('@/lib/server/course-blueprint-versions', () => ({ saveCourseBlueprintVersion: mocks.save }))
const guidance = { course_expectations_markdown: 'Rules', assignment_guidance_markdown: '', test_guidance_markdown: '', unit_exceptions: [] }
const input = { blueprint_id: 'bp', expected_content_version_id: 'v3', expected_guidance_version_id: 'v3', expected_draft_revision: 4 }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.permission.mockResolvedValue({ ok: true })
  mocks.context.mockResolvedValue({ ok: true, context: { blueprint_id: 'bp', content_version_id: 'v3', source_blueprint_version_id: 'v3', source_blueprint_version_number: 3, guidance } })
  mocks.detail.mockResolvedValue({ detail: { id: 'bp', content_revision: 4, authoring_guidance: guidance } })
  mocks.save.mockResolvedValue({ ok: true, version: { id: 'v4', version_number: 4 } })
  mocks.rpc.mockResolvedValue({ data: {}, error: null })
})
describe('classroom guidance adoption', () => {
  it('uses guidance equality even when content has a newer revision', async () => {
    expect(await previewClassroomGuidanceAdoption('owner', 'class')).toMatchObject({ ok: true, preview: { changed: false, expected_draft_revision: 4, current_guidance_version_number: 3 } })
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('saves the reviewed Draft then uses atomic version and revision guards', async () => {
    expect(await adoptClassroomGuidance('owner', 'class', input)).toEqual({ ok: true, version: 4 })
    expect(mocks.rpc).toHaveBeenCalledWith('adopt_classroom_authoring_guidance_v1', {
      p_actor_id: 'owner', p_classroom_id: 'class', p_blueprint_id: 'bp',
      p_expected_content_version_id: 'v3', p_expected_guidance_version_id: 'v3',
      p_expected_draft_revision: 4, p_guidance_version_id: 'v4',
    })
  })
  it('rejects a changed Draft before creating a Version', async () => {
    mocks.detail.mockResolvedValue({ detail: { id: 'bp', content_revision: 5 } })
    expect(await adoptClassroomGuidance('owner', 'class', input)).toMatchObject({ ok: false, status: 409 })
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects foreign lineage and ownership before reading the Draft', async () => {
    expect(await adoptClassroomGuidance('owner', 'class', { ...input, blueprint_id: 'foreign' })).toMatchObject({ ok: false, status: 409 })
    expect(mocks.detail).not.toHaveBeenCalled()
    mocks.context.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    expect(await adoptClassroomGuidance('other', 'class', input)).toMatchObject({ ok: false, status: 403 })
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it('returns a recoverable stale error when guidance changes after saving the Version', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: '40001' } })
    expect(await adoptClassroomGuidance('owner', 'class', input)).toMatchObject({ ok: false, status: 409 })
  })
})
