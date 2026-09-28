import { describe, expect, it, vi } from 'vitest'
import { acquireCourseBlueprintDraftSlot } from '@/lib/server/course-blueprint-draft-admission'

function client(results: Array<{ data: unknown; error: { message: string } | null }>) {
  return { rpc: vi.fn().mockImplementation(() => Promise.resolve(results.shift())) }
}

describe('Blueprint guided draft shared admission', () => {
  it('reserves and releases the teacher lease through the database', async () => {
    const supabase = client([
      {
        data: {
          ok: true,
          lease_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          lease_expires_at: '2026-09-28T15:00:00+00:00',
        },
        error: null,
      },
      { data: true, error: null },
    ])

    const release = await acquireCourseBlueprintDraftSlot({
      teacherId: 'teacher-1', supabase,
    })
    await release()

    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'acquire_course_blueprint_draft_slot', {
      p_teacher_id: 'teacher-1',
    })
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'release_course_blueprint_draft_slot', {
      p_teacher_id: 'teacher-1',
      p_lease_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })
  })

  it.each([
    ['active', 'An AI draft is already running for this teacher.'],
    ['rate_limited', 'Too many AI drafts. Try again in a few minutes.'],
  ] as const)('returns 429 for %s before the provider can be called', async (reason, message) => {
    const supabase = client([{ data: { ok: false, reason }, error: null }])
    await expect(acquireCourseBlueprintDraftSlot({
      teacherId: 'teacher-1', supabase,
    })).rejects.toMatchObject({ statusCode: 429, message })
  })

  it.each([
    [{ data: null, error: { message: 'missing RPC' } }],
    [{ data: { ok: true, lease_token: 'invalid' }, error: null }],
  ])('fails closed when the database admission response is unavailable or invalid', async (result) => {
    const supabase = client([result])
    await expect(acquireCourseBlueprintDraftSlot({
      teacherId: 'teacher-1', supabase,
    })).rejects.toMatchObject({ statusCode: 503 })
  })
})
