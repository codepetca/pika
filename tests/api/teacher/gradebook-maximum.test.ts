import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from '@/app/api/teacher/gradebook/maximums/route'
import { loadGradebookMaximumState, saveEffectiveGradebookMark } from '@/lib/server/gradebook-maximum'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc }) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: '10000000-0000-4000-8000-000000000009' })) }))
const classroom_id = '10000000-0000-4000-8000-000000000001', assessment_id = '10000000-0000-4000-8000-000000000002'
const payload = { classroom_id, assessment_id, assessment_type: 'test', maximum: 50, mode: 'preserve_percentages', expected_maximum: 100, expected_scale: 1 }
const request = (body: unknown) => new NextRequest('http://localhost/api/teacher/gradebook/maximums', { method: 'PUT', body: JSON.stringify(body) })
describe('Gradebook maximum API and rollout boundary', () => {
  beforeEach(() => rpc.mockReset().mockResolvedValue({ data: { saved: true }, error: null }))
  it('passes the teacher identity, chosen behavior and stale-read fence to the atomic writer', async () => {
    expect((await PUT(request(payload))).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('set_gradebook_maximum_override', expect.objectContaining({ p_teacher_id: '10000000-0000-4000-8000-000000000009', p_maximum: 50, p_mode: 'preserve_percentages', p_expected_maximum: 100, p_expected_scale: 1 }))
  })
  it.each([0, -1, 1.01, 1000000])('rejects invalid maximum %s before writing', async (maximum) => {
    expect((await PUT(request({ ...payload, maximum }))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('requires reset to carry null and rejects arbitrary fields', async () => {
    expect((await PUT(request({ ...payload, mode: 'reset' }))).status).toBe(400)
    expect((await PUT(request({ ...payload, mode: 'reset', maximum: null }))).status).toBe(200)
    expect((await PUT(request({ ...payload, teacher_id: 'other' }))).status).toBe(400)
  })
  it.each([['42501',403],['55000',409],['40001',409],['P0002',404],['22023',400],['PGRST202',409]])('maps database boundary %s', async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { code } })
    expect((await PUT(request(payload))).status).toBe(status)
  })
  it('keeps the pre-migration gradebook readable and fails on unexpected read errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    expect((await loadGradebookMaximumState(classroom_id)).available).toBe(false)
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000' } })
    await expect(loadGradebookMaximumState(classroom_id)).rejects.toThrow('Could not load')
  })
  it('loads keyed maximums and sends effective marks to the serialized normalizing writer', async () => {
    rpc.mockResolvedValue({ data: [{ assessment_type: 'test', assessment_id, maximum: 50, score_scale: 0.5 }], error: null })
    const state = await loadGradebookMaximumState(classroom_id)
    expect(state.states.get(`test:${assessment_id}`)).toMatchObject({ maximum: 50, score_scale: 0.5 })
    rpc.mockResolvedValue({ data: { saved: true }, error: null })
    await saveEffectiveGradebookMark('teacher', classroom_id, 'test', assessment_id, 'student', 40.1)
    expect(rpc).toHaveBeenLastCalledWith('save_gradebook_effective_mark', expect.objectContaining({ p_earned: 40.1 }))
  })
})
