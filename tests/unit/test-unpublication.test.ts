import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getServiceRoleClient } from '@/lib/supabase'
import { returnTestToDraft } from '@/lib/server/test-unpublication'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))

const teacherId = '11111111-1111-4111-8111-111111111111'
const testId = '22222222-2222-4222-8222-222222222222'
const classroomId = '33333333-3333-4333-8333-333333333333'
const stamp = '2026-10-09T10:00:00Z'
const row = {
  id: testId, classroom_id: classroomId, artifact_id: '44444444-4444-4444-8444-444444444444',
  source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null,
  created_at: stamp, created_by: teacherId, updated_at: stamp, title: 'Current title',
  status: 'draft', show_results: true, documents: [], gradebook_category_id: null,
  gradebook_maximum_override: null, gradebook_score_scale: 1, gradebook_weight: 10,
  include_in_final: true, points_possible: 100, position: 0, questions_locked_at: null,
}
const rpc = vi.fn()

describe('returnTestToDraft RPC boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as never)
    rpc.mockResolvedValue({ data: { test: row, draft_version: 8 }, error: null })
  })

  it('returns the SQL Test and draft version, including safe retries', async () => {
    expect(await returnTestToDraft(teacherId, testId, classroomId)).toEqual({ test: { ...row, assessment_type: 'test' }, draft_version: 8 })
    expect(await returnTestToDraft(teacherId, testId, classroomId)).toEqual({ test: { ...row, assessment_type: 'test' }, draft_version: 8 })
    expect(rpc).toHaveBeenCalledWith('return_test_to_draft_atomic', { p_teacher_id: teacherId, p_test_id: testId })
  })

  it.each([['PT403', 403], ['PT404', 404], ['PT409', 409], ['55P03', 409], ['PGRST202', 503], ['42501', 503]])('maps %s without exposing SQL text', async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private SQL detail' } })
    await expect(returnTestToDraft(teacherId, testId, classroomId)).rejects.toMatchObject({ statusCode: status })
  })

  it('fails closed on a mismatched or malformed acknowledgement', async () => {
    rpc.mockResolvedValue({ data: { test: { ...row, id: classroomId }, draft_version: 8 }, error: null })
    await expect(returnTestToDraft(teacherId, testId, classroomId)).rejects.toMatchObject({ statusCode: 503 })
    rpc.mockResolvedValue({ data: { test: { ...row, classroom_id: testId }, draft_version: 8 }, error: null })
    await expect(returnTestToDraft(teacherId, testId, classroomId)).rejects.toMatchObject({ statusCode: 503 })
    rpc.mockResolvedValue({ data: { test: { ...row, status: 'closed' }, draft_version: 8 }, error: null })
    await expect(returnTestToDraft(teacherId, testId, classroomId)).rejects.toMatchObject({ statusCode: 503 })
    rpc.mockResolvedValue({ data: { test: row, draft_version: 8 }, error: { code: 'PT409', message: 'private SQL detail' } })
    await expect(returnTestToDraft(teacherId, testId, classroomId)).rejects.toMatchObject({ statusCode: 503 })
  })
})
