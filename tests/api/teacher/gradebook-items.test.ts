import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/gradebook/items/route'
import { PUT } from '@/app/api/teacher/gradebook/items/scores/route'
import { gradebookItemMutationSchema, gradebookItemScoreSchema } from '@/lib/validations/gradebook-items'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc }) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: '10000000-0000-4000-8000-000000000009' })) }))
const classroom_id = '10000000-0000-4000-8000-000000000001'
const item_id = '10000000-0000-4000-8000-000000000002'
const student_id = '10000000-0000-4000-8000-000000000003'
const create = { action: 'create', classroom_id, item_id, title: 'Attendance – Term 1', points_possible: 20, gradebook_category_id: null, gradebook_weight: 10, include_in_final: true }
const request = (body: unknown) => new NextRequest('http://localhost/api/teacher/gradebook/items', { method: 'POST', body: JSON.stringify(body) })

describe('standalone Gradebook mutations', () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { ok: true }, error: null }) })
  it('creates a first-class item through the authorized atomic workflow', async () => {
    expect((await POST(request(create))).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('mutate_gradebook_item', expect.objectContaining({ p_teacher_id: '10000000-0000-4000-8000-000000000009', p_action: 'create', p_classroom_id: classroom_id, p_item_id: item_id, p_title: create.title }))
  })
  it('preserves zero and uses null exclusively for clearing original scores', async () => {
    for (const earned of [0, null]) {
      expect((await PUT(request({ classroom_id, item_id, student_id, earned }))).status).toBe(200)
      expect(rpc).toHaveBeenLastCalledWith('set_gradebook_item_score', expect.objectContaining({ p_earned: earned }))
    }
  })
  it('rejects extra fields on return and malformed scoring before persistence', async () => {
    expect((await POST(request({ action: 'return_marks', classroom_id, item_id, earned: 20 }))).status).toBe(400)
    expect((await PUT(request({ classroom_id, item_id, student_id, earned: -1 }))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([['42501', 403], ['55000', 409], ['P0002', 404], ['22023', 400], ['23505', 409], ['PGRST202', 409], ['XX000', 500]])('maps database boundary %s to %s', async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'database error' } })
    expect((await POST(request(create))).status).toBe(status)
  })
  it('validates item bounds and requires an explicit full detail contract', () => {
    for (const patch of [{ title: ' ' }, { points_possible: 0 }, { points_possible: 1.01 }, { gradebook_weight: 1.5 }, { gradebook_weight: 1000 }, { include_in_final: 'true' }]) {
      expect(gradebookItemMutationSchema.safeParse({ ...create, ...patch }).success).toBe(false)
    }
    expect(gradebookItemMutationSchema.safeParse({ action: 'update', classroom_id, item_id, title: 'Only title' }).success).toBe(false)
    expect(gradebookItemScoreSchema.safeParse({ classroom_id, item_id, student_id, earned: 999999.9 }).success).toBe(true)
    expect(gradebookItemScoreSchema.safeParse({ classroom_id, item_id, student_id, earned: 1000000 }).success).toBe(false)
  })
})
