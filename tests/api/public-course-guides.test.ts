import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/public/course-guides/[slug]/route'

const mocks = vi.hoisted(() => ({
  getPublishedCourseGuide: vi.fn(),
}))

vi.mock('@/lib/server/course-guide', () => ({
  getPublishedCourseGuide: mocks.getPublishedCourseGuide,
}))

describe('GET /api/public/course-guides/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the sanitized shared guide payload', async () => {
    const guide = { classroom: { title: 'Computer Science' } }
    mocks.getPublishedCourseGuide.mockResolvedValue({ ok: true, guide })

    const response = await GET(new Request('http://localhost/api/public/course-guides/computer-science') as never, {
      params: Promise.resolve({ slug: 'computer-science' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ guide })
    expect(mocks.getPublishedCourseGuide).toHaveBeenCalledWith('computer-science')
  })

  it('returns a generic not-found response for an unpublished guide', async () => {
    mocks.getPublishedCourseGuide.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Actual course site not found',
    })

    const response = await GET(new Request('http://localhost/api/public/course-guides/missing') as never, {
      params: Promise.resolve({ slug: 'missing' }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Actual course site not found' })
  })

  it('rejects malformed public addresses', async () => {
    const response = await GET(new Request('http://localhost/api/public/course-guides/Bad%20Slug') as never, {
      params: Promise.resolve({ slug: 'Bad Slug' }),
    })

    expect(response.status).toBe(400)
    expect(mocks.getPublishedCourseGuide).not.toHaveBeenCalled()
  })
})
