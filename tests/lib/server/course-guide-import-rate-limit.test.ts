import { describe, expect, it, vi } from 'vitest'
import { acquireCourseGuideImportExtractionSlot } from '@/lib/server/course-guide-import-rate-limit'

function createClient(results: Array<{ data: unknown; error: unknown }>) {
  return {
    rpc: vi.fn().mockImplementation(() => Promise.resolve(results.shift())),
  }
}

describe('course guide curriculum import shared rate limit', () => {
  it('acquires and releases the database lease for the teacher', async () => {
    const client = createClient([
      {
        data: {
          ok: true,
          lease_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          lease_expires_at: '2026-08-28T15:00:00+00:00',
        },
        error: null,
      },
      { data: true, error: null },
    ])

    const release = await acquireCourseGuideImportExtractionSlot({
      teacherId: 'teacher-1',
      supabase: client as never,
    })
    await release()

    expect(client.rpc).toHaveBeenNthCalledWith(1, 'acquire_course_guide_import_extraction_slot', {
      p_teacher_id: 'teacher-1',
    })
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'release_course_guide_import_extraction_slot', {
      p_teacher_id: 'teacher-1',
      p_lease_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })
  })

  it.each([
    ['active', 'A curriculum import is already running for this teacher.'],
    ['rate_limited', 'Too many curriculum import attempts. Try again in a few minutes.'],
  ] as const)('returns 429 when the shared limiter reports %s', async (reason, message) => {
    const client = createClient([{ data: { ok: false, reason }, error: null }])

    await expect(acquireCourseGuideImportExtractionSlot({
      teacherId: 'teacher-1',
      supabase: client as never,
    })).rejects.toMatchObject({ statusCode: 429, message })
  })

  it('fails closed when the shared limiter is unavailable', async () => {
    const client = createClient([{ data: null, error: { message: 'missing function' } }])

    await expect(acquireCourseGuideImportExtractionSlot({
      teacherId: 'teacher-1',
      supabase: client as never,
    })).rejects.toMatchObject({
      statusCode: 503,
      message: 'Curriculum import is temporarily unavailable.',
    })
  })
})
