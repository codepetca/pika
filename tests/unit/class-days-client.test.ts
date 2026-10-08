import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchClassDaysForClassroom, invalidateClassDaysForClassroom } from '@/lib/class-days-client'

describe('class-days-client', () => {
  afterEach(() => {
    invalidateClassDaysForClassroom('classroom-1')
    invalidateClassDaysForClassroom('classroom-2')
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
    ['null field', { class_days: null }],
    ['object field', { class_days: {} }],
    ['string field', { class_days: 'unexpected' }],
    ['number field', { class_days: 7 }],
    ['boolean field', { class_days: false }],
  ] as const

  it.each(invalidBodies)('rejects %s without caching and recovers on the next read', async (_label, body) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(body))
      .mockResolvedValueOnce(Response.json({ class_days: [{ id: 'recovered' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchClassDaysForClassroom('classroom-1')).rejects.toThrow()
    await expect(fetchClassDaysForClassroom('classroom-1')).resolves.toEqual([{ id: 'recovered' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(['invalid JSON', 'consumed body'])('rejects an unreadable successful %s body without caching', async (kind) => {
    const unreadable = kind === 'invalid JSON' ? new Response('<html>failed</html>') : Response.json({ class_days: [] })
    if (kind === 'consumed body') await unreadable.json()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unreadable)
      .mockResolvedValueOnce(Response.json({ class_days: [{ id: 'recovered' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchClassDaysForClassroom('classroom-1')).rejects.toBeInstanceOf(kind === 'consumed body' ? TypeError : SyntaxError)
    await expect(fetchClassDaysForClassroom('classroom-1')).resolves.toEqual([{ id: 'recovered' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([{ records: [] }, { records: [{ id: 'present' }] }])('caches a legitimate list $records', async ({ records }) => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ class_days: records }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchClassDaysForClassroom('classroom-1')).resolves.toEqual(records)
    await expect(fetchClassDaysForClassroom('classroom-1')).resolves.toEqual(records)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['readable error', () => Response.json({ error: 'Specific failure' }, { status: 503 }), 'Specific failure'],
    ['unreadable error', () => new Response('<html>failed</html>', { status: 503 }), 'Failed to load class days'],
    ['null error', () => Response.json(null, { status: 503 }), 'Failed to load class days'],
    ['non-string error', () => Response.json({ error: 7 }, { status: 503 }), 'Failed to load class days'],
  ])('preserves %s HTTP failure and permits retry', async (_label, response, message) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(Response.json({ class_days: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchClassDaysForClassroom('classroom-1')).rejects.toThrow(message)
    await expect(fetchClassDaysForClassroom('classroom-1')).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('scopes cached days and invalidation to the classroom', async () => {
    const fetchMock = vi.fn(async (input) => Response.json({ class_days: [{ id: input }] }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchClassDaysForClassroom('classroom-1')
    await fetchClassDaysForClassroom('classroom-2')
    invalidateClassDaysForClassroom('classroom-1')
    await fetchClassDaysForClassroom('classroom-2')
    await fetchClassDaysForClassroom('classroom-1')
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      '/api/classrooms/classroom-1/class-days',
      '/api/classrooms/classroom-2/class-days',
      '/api/classrooms/classroom-1/class-days',
    ])
  })

  it('retains the 20-second TTL', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const fetchMock = vi.fn(async () => Response.json({ class_days: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchClassDaysForClassroom('classroom-1')
    clock.mockReturnValue(20_999)
    await fetchClassDaysForClassroom('classroom-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    clock.mockReturnValue(21_000)
    await fetchClassDaysForClassroom('classroom-1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('deduplicates a pending malformed read and recovers after rejection', async () => {
    let resolve!: (response: Response) => void
    const response = new Promise<Response>((done) => { resolve = done })
    const fetchMock = vi.fn().mockReturnValueOnce(response)
      .mockResolvedValueOnce(Response.json({ class_days: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const reads = Promise.allSettled([
      fetchClassDaysForClassroom('classroom-1'),
      fetchClassDaysForClassroom('classroom-1'),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolve(Response.json({}))
    expect((await reads).map((result) => result.status)).toEqual(['rejected', 'rejected'])
    await expect(fetchClassDaysForClassroom('classroom-1')).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not let an invalidated malformed response delete a newer cached list', async () => {
    let resolve!: (response: Response) => void
    const response = new Promise<Response>((done) => { resolve = done })
    const fetchMock = vi.fn().mockReturnValueOnce(response)
      .mockResolvedValueOnce(Response.json({ class_days: [{ id: 'fresh' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const stale = fetchClassDaysForClassroom('classroom-1').catch((error) => error)
    invalidateClassDaysForClassroom('classroom-1')
    await expect(fetchClassDaysForClassroom('classroom-1')).resolves.toEqual([{ id: 'fresh' }])
    resolve(Response.json({}))
    await expect(stale).resolves.toBeInstanceOf(Error)
    await expect(fetchClassDaysForClassroom('classroom-1')).resolves.toEqual([{ id: 'fresh' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
