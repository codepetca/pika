import { afterEach, describe, expect, it, vi } from 'vitest'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertStudentCanAccessClassroom, assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
const ownerId = '11111111-1111-4111-8111-111111111111'
const memberId = '22222222-2222-4222-8222-222222222222'
const classroomId = '33333333-3333-4333-8333-333333333333'
const row = { id: classroomId, teacher_id: ownerId, archived_at: null }

describe('live helper compatibility with shadow mode', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

  it.each([
    { name: 'owner', user: ownerId, row, enrollment: null },
    { name: 'owner', user: memberId, row, enrollment: null },
    { name: 'manage', user: ownerId, row, enrollment: null },
    { name: 'manage', user: ownerId, row: { ...row, archived_at: '2026-09-01T00:00:00Z' }, enrollment: null },
    { name: 'manage', user: memberId, row, enrollment: null },
    { name: 'participate', user: memberId, row, enrollment: { id: memberId } },
    { name: 'participate', user: memberId, row, enrollment: null },
    { name: 'participate', user: memberId, row, enrollment: null, enrollmentError: { code: '08006' } },
    { name: 'participate', user: memberId, row: null, enrollment: null },
    { name: 'owner', user: ownerId, row: null, enrollment: null, error: { code: '08006' } },
    { name: 'participate', user: memberId, row: { ...row, archived_at: '2026-09-01T00:00:00Z' }, enrollment: null },
    // Historical self-enrollment intentionally differs from the target owner/member policy.
    { name: 'participate', user: ownerId, row, enrollment: { id: ownerId } },
  ])('preserves exact result and query sequence: $name $user $row', async (scenario) => {
    vi.stubEnv('PIKA_ACCESS_SHADOW_CLASSROOM_IDS', classroomId)
    vi.stubEnv('PIKA_ACCESS_SHADOW_SAMPLE_RATE', '1')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const run = async (enabled: boolean) => {
      vi.stubEnv('PIKA_ACCESS_SHADOW_ENABLED', String(enabled))
      const queries: unknown[][] = []
      const supabase = { from: (table: string) => {
        queries.push(['from', table])
        const builder = {
          select: (value: string) => { queries.push(['select', value]); return builder },
          eq: (field: string, value: string) => { queries.push(['eq', field, value]); return builder },
          single: async () => {
            queries.push(['single'])
            return table === 'classrooms' ? { data: scenario.row, error: scenario.error ?? null }
              : { data: scenario.enrollment, error: scenario.enrollmentError ?? null }
          },
        }
        return builder
      } }
      vi.mocked(getServiceRoleClient).mockReturnValue(supabase as unknown as ReturnType<typeof getServiceRoleClient>)
      const helper = scenario.name === 'owner' ? assertTeacherOwnsClassroom
        : scenario.name === 'manage' ? assertTeacherCanMutateClassroom : assertStudentCanAccessClassroom
      return { result: await helper(scenario.user, classroomId), queries }
    }
    const baseline = await run(false)
    expect(info).not.toHaveBeenCalled()
    expect(await run(true)).toEqual(baseline)
    expect(info).toHaveBeenCalled()
    if (scenario.user === ownerId && scenario.name === 'participate') {
      expect(info.mock.calls.at(-1)?.[1]).toMatchObject({ comparison: 'would_deny' })
      expect(baseline.result.ok).toBe(true)
    }
    info.mockImplementation(() => { throw new Error('logger unavailable') })
    expect(await run(true)).toEqual(baseline)
  })
})
