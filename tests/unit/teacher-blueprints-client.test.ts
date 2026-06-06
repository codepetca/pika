import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTeacherBlueprints, invalidateTeacherBlueprints } from '@/lib/teacher-blueprints-client'

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

describe('teacher blueprints client', () => {
  afterEach(() => {
    invalidateTeacherBlueprints()
    vi.unstubAllGlobals()
  })

  it('bypasses shared caching when the current user id cannot be verified', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Temporary auth failure' }, false))
      .mockResolvedValueOnce(jsonResponse({ blueprints: [{ id: 'teacher-a-blueprint' }] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Temporary auth failure' }, false))
      .mockResolvedValueOnce(jsonResponse({ blueprints: [{ id: 'teacher-b-blueprint' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchTeacherBlueprints()).resolves.toEqual([{ id: 'teacher-a-blueprint' }])
    await expect(fetchTeacherBlueprints()).resolves.toEqual([{ id: 'teacher-b-blueprint' }])

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/auth/me', { cache: 'no-store' })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/teacher/course-blueprints')
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/auth/me', { cache: 'no-store' })
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/teacher/course-blueprints')
  })
})
