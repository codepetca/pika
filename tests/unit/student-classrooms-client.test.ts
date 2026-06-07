import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchStudentClassrooms, invalidateStudentClassrooms } from '@/lib/student-classrooms-client'

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

describe('student classrooms client', () => {
  afterEach(() => {
    invalidateStudentClassrooms()
    vi.unstubAllGlobals()
  })

  it('reuses cached classroom lists for the verified current student', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'student-1' } }))
      .mockResolvedValueOnce(jsonResponse({ classrooms: [{ id: 'classroom-1' }] }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'student-1' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchStudentClassrooms()).resolves.toEqual([{ id: 'classroom-1' }])
    await expect(fetchStudentClassrooms()).resolves.toEqual([{ id: 'classroom-1' }])

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/auth/me', { cache: 'no-store' })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/student/classrooms')
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/auth/me', { cache: 'no-store' })
  })

  it('bypasses shared caching when the current user id cannot be verified', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Temporary auth failure' }, false))
      .mockResolvedValueOnce(jsonResponse({ classrooms: [{ id: 'student-a-classroom' }] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Temporary auth failure' }, false))
      .mockResolvedValueOnce(jsonResponse({ classrooms: [{ id: 'student-b-classroom' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchStudentClassrooms()).resolves.toEqual([{ id: 'student-a-classroom' }])
    await expect(fetchStudentClassrooms()).resolves.toEqual([{ id: 'student-b-classroom' }])

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/auth/me', { cache: 'no-store' })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/student/classrooms')
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/auth/me', { cache: 'no-store' })
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/student/classrooms')
  })
})
