import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchStudentEntriesForClassroom, invalidateStudentEntriesForClassroom } from '@/lib/student-entries-client'

describe('student-entries-client', () => {
  afterEach(() => {
    invalidateStudentEntriesForClassroom('classroom-1')
    invalidateStudentEntriesForClassroom('classroom-2')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const invalidBodies = [
    ['null envelope', null],
    ['number envelope', 7],
    ['string envelope', 'unexpected'],
    ['boolean envelope', true],
    ['array envelope', []],
    ['missing field', {}],
    ['null field', { entries: null }],
    ['object field', { entries: {} }],
    ['string field', { entries: 'unexpected' }],
    ['number field', { entries: 7 }],
    ['boolean field', { entries: false }],
  ] as const

  it.each(invalidBodies)('rejects %s without caching and recovers on the next read', async (_label, body) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(body))
      .mockResolvedValueOnce(Response.json({ entries: [{ id: 'recovered' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchStudentEntriesForClassroom('classroom-1')).rejects.toThrow()
    await expect(fetchStudentEntriesForClassroom('classroom-1')).resolves.toEqual([{ id: 'recovered' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(['invalid JSON', 'consumed body'])('rejects an unreadable successful %s body without caching', async (kind) => {
    const unreadable = kind === 'invalid JSON' ? new Response('<html>failed</html>') : Response.json({ entries: [] })
    if (kind === 'consumed body') await unreadable.json()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unreadable)
      .mockResolvedValueOnce(Response.json({ entries: [{ id: 'recovered' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchStudentEntriesForClassroom('classroom-1')).rejects.toBeInstanceOf(kind === 'consumed body' ? TypeError : SyntaxError)
    await expect(fetchStudentEntriesForClassroom('classroom-1')).resolves.toEqual([{ id: 'recovered' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([{ records: [] }, { records: [{ id: 'present' }] }])('caches a legitimate list $records', async ({ records }) => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ entries: records }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchStudentEntriesForClassroom('classroom-1')).resolves.toEqual(records)
    await expect(fetchStudentEntriesForClassroom('classroom-1')).resolves.toEqual(records)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['readable error', () => Response.json({ error: 'Specific failure' }, { status: 503 }), 'Specific failure'],
    ['unreadable error', () => new Response('<html>failed</html>', { status: 503 }), 'Failed to load entries'],
    ['null error', () => Response.json(null, { status: 503 }), 'Failed to load entries'],
    ['non-string error', () => Response.json({ error: 7 }, { status: 503 }), 'Failed to load entries'],
  ])('preserves %s HTTP failure and permits retry', async (_label, response, message) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(Response.json({ entries: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchStudentEntriesForClassroom('classroom-1')).rejects.toThrow(message)
    await expect(fetchStudentEntriesForClassroom('classroom-1')).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps all and limited entry reads separate and invalidates every limit for one classroom', async () => {
    const fetchMock = vi.fn(async (input) => Response.json({ entries: [{ id: input }] }))
    vi.stubGlobal('fetch', fetchMock)
    const all = await fetchStudentEntriesForClassroom('classroom-1')
    const one = await fetchStudentEntriesForClassroom('classroom-1', { limit: 1 })
    const two = await fetchStudentEntriesForClassroom('classroom-1', { limit: 2 })
    const other = await fetchStudentEntriesForClassroom('classroom-2', { limit: 1 })
    expect(all).toEqual([{ id: '/api/student/entries?classroom_id=classroom-1' }])
    expect(one).toEqual([{ id: '/api/student/entries?classroom_id=classroom-1&limit=1' }])
    expect(two).toEqual([{ id: '/api/student/entries?classroom_id=classroom-1&limit=2' }])
    await expect(fetchStudentEntriesForClassroom('classroom-1')).resolves.toEqual(all)
    await expect(fetchStudentEntriesForClassroom('classroom-1', { limit: 1 })).resolves.toEqual(one)
    await expect(fetchStudentEntriesForClassroom('classroom-1', { limit: 2 })).resolves.toEqual(two)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    invalidateStudentEntriesForClassroom('classroom-1')
    await expect(fetchStudentEntriesForClassroom('classroom-2', { limit: 1 })).resolves.toEqual(other)
    await fetchStudentEntriesForClassroom('classroom-1')
    await fetchStudentEntriesForClassroom('classroom-1', { limit: 1 })
    await fetchStudentEntriesForClassroom('classroom-1', { limit: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(7)
  })

  it('retains the 15-second TTL', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const fetchMock = vi.fn(async () => Response.json({ entries: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchStudentEntriesForClassroom('classroom-1')
    clock.mockReturnValue(15_999)
    await fetchStudentEntriesForClassroom('classroom-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    clock.mockReturnValue(16_000)
    await fetchStudentEntriesForClassroom('classroom-1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
