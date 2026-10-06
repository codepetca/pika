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
    vi.restoreAllMocks()
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
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/student/classrooms', undefined)
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
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/student/classrooms', undefined)
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/auth/me', { cache: 'no-store' })
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/student/classrooms', undefined)
  })

  const invalidBodies = [
    ['null envelope', null],
    ['number envelope', 7],
    ['string envelope', 'unexpected'],
    ['boolean envelope', true],
    ['array envelope', []],
    ['missing field', {}],
    ['null field', { classrooms: null }],
    ['object field', { classrooms: {} }],
    ['string field', { classrooms: 'unexpected' }],
    ['number field', { classrooms: 7 }],
    ['boolean field', { classrooms: false }],
  ] as const

  it.each(invalidBodies)('rejects %s without caching and recovers on the next read', async (_label, body) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(body))
      .mockResolvedValueOnce(Response.json({ classrooms: [{ id: 'recovered' }] }))
    vi.stubGlobal('fetch', vi.fn(async (input) => input === '/api/auth/me'
      ? Response.json({ user: { id: 'student-1' } })
      : fetchMock(input)))

    await expect(fetchStudentClassrooms()).rejects.toThrow()
    await expect(fetchStudentClassrooms()).resolves.toEqual([{ id: 'recovered' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(['invalid JSON', 'consumed body'])('rejects an unreadable successful %s body without caching', async (kind) => {
    const unreadable = kind === 'invalid JSON' ? new Response('<html>failed</html>') : Response.json({ classrooms: [] })
    if (kind === 'consumed body') await unreadable.json()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unreadable)
      .mockResolvedValueOnce(Response.json({ classrooms: [{ id: 'recovered' }] }))
    vi.stubGlobal('fetch', vi.fn(async (input) => input === '/api/auth/me'
      ? Response.json({ user: { id: 'student-1' } })
      : fetchMock(input)))

    await expect(fetchStudentClassrooms()).rejects.toBeInstanceOf(kind === 'consumed body' ? TypeError : SyntaxError)
    await expect(fetchStudentClassrooms()).resolves.toEqual([{ id: 'recovered' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([{ records: [] }, { records: [{ id: 'present' }] }])('caches a legitimate list $records', async ({ records }) => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ classrooms: records }))
    vi.stubGlobal('fetch', vi.fn(async (input) => input === '/api/auth/me'
      ? Response.json({ user: { id: 'student-1' } })
      : fetchMock(input)))

    await expect(fetchStudentClassrooms()).resolves.toEqual(records)
    await expect(fetchStudentClassrooms()).resolves.toEqual(records)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['readable error', () => Response.json({ error: 'Specific failure' }, { status: 503 }), 'Specific failure'],
    ['unreadable error', () => new Response('<html>failed</html>', { status: 503 }), 'Failed to load classrooms'],
    ['null error', () => Response.json(null, { status: 503 }), 'Failed to load classrooms'],
    ['non-string error', () => Response.json({ error: 7 }, { status: 503 }), 'Failed to load classrooms'],
  ])('preserves %s HTTP failure and permits retry', async (_label, response, message) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(Response.json({ classrooms: [] }))
    vi.stubGlobal('fetch', vi.fn(async (input) => input === '/api/auth/me'
      ? Response.json({ user: { id: 'student-1' } })
      : fetchMock(input)))

    await expect(fetchStudentClassrooms()).rejects.toThrow(message)
    await expect(fetchStudentClassrooms()).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps classroom caches scoped to the verified student', async () => {
    let studentId = 'student-1'
    const fetchMock = vi.fn(async (input) => input === '/api/auth/me'
      ? Response.json({ user: { id: studentId } })
      : Response.json({ classrooms: [{ id: studentId }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchStudentClassrooms()).resolves.toEqual([{ id: 'student-1' }])
    studentId = 'student-2'
    await expect(fetchStudentClassrooms()).resolves.toEqual([{ id: 'student-2' }])
    studentId = 'student-1'
    await expect(fetchStudentClassrooms()).resolves.toEqual([{ id: 'student-1' }])
    expect(fetchMock.mock.calls.filter(([input]) => input === '/api/student/classrooms')).toHaveLength(2)
  })

  it.each(['unreadable identity', 'missing identity'])('bypasses caching for %s', async (kind) => {
    const classroomsFetch = vi.fn(async () => Response.json({ classrooms: [] }))
    vi.stubGlobal('fetch', vi.fn(async (input) => input === '/api/auth/me'
      ? kind === 'unreadable identity' ? new Response('<html>failed</html>') : Response.json({ user: {} })
      : classroomsFetch()))

    await expect(fetchStudentClassrooms()).resolves.toEqual([])
    await expect(fetchStudentClassrooms()).resolves.toEqual([])
    expect(classroomsFetch).toHaveBeenCalledTimes(2)
  })

  it('retains the 20-second TTL and invalidates the student list', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const classroomsFetch = vi.fn(async () => Response.json({ classrooms: [] }))
    vi.stubGlobal('fetch', vi.fn(async (input) => input === '/api/auth/me'
      ? Response.json({ user: { id: 'student-1' } }) : classroomsFetch()))
    await fetchStudentClassrooms()
    clock.mockReturnValue(20_999)
    await fetchStudentClassrooms()
    expect(classroomsFetch).toHaveBeenCalledTimes(1)
    clock.mockReturnValue(21_000)
    await fetchStudentClassrooms()
    expect(classroomsFetch).toHaveBeenCalledTimes(2)
    invalidateStudentClassrooms()
    await fetchStudentClassrooms()
    expect(classroomsFetch).toHaveBeenCalledTimes(3)
  })
})
