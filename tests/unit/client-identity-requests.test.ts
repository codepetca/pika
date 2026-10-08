import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchStudentClassrooms, invalidateStudentClassrooms } from '@/lib/student-classrooms-client'
import { fetchTeacherClassrooms, invalidateTeacherClassrooms } from '@/lib/teacher-classrooms-client'
import {
  fetchTeacherBlueprintDetail,
  fetchTeacherBlueprints,
  invalidateTeacherBlueprints,
} from '@/lib/teacher-blueprints-client'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const clients = [
  { name: 'student classrooms', load: fetchStudentClassrooms, payload: (id: string) => ({ classrooms: [{ id }] }) },
  { name: 'teacher classrooms', load: fetchTeacherClassrooms, payload: (id: string) => ({ classrooms: [{ id }] }) },
  { name: 'teacher blueprints', load: fetchTeacherBlueprints, payload: (id: string) => ({ blueprints: [{ id }] }) },
]

describe('client identity requests', () => {
  afterEach(() => {
    invalidateStudentClassrooms()
    invalidateTeacherClassrooms()
    invalidateTeacherBlueprints()
    vi.unstubAllGlobals()
  })

  it('shares one identity lookup across parallel classroom and blueprint reads', async () => {
    const identity = deferred<Response>()
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') return identity.promise
      if (url === '/api/teacher/course-blueprints/blueprint-1') {
        return Promise.resolve(jsonResponse({ blueprint: { id: 'blueprint-1' } }))
      }
      return Promise.resolve(jsonResponse({ classrooms: [], blueprints: [] }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const reads = Promise.all([
      fetchTeacherClassrooms(),
      fetchTeacherBlueprints(),
      fetchTeacherBlueprintDetail('blueprint-1'),
      fetchStudentClassrooms(),
    ])
    // Settle pending callers even when this assertion fails in the red run.
    const identityCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/auth/me').length
    identity.resolve(jsonResponse({ user: { id: 'actor-a' } }))
    await expect(reads).resolves.toEqual([[], [], { id: 'blueprint-1' }, []])
    expect(identityCalls).toBe(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', { cache: 'no-store' })
  })

  it.each(clients)('keeps $name caches isolated after a settled actor change', async ({ load, payload }) => {
    let actor = 'actor-a'
    const fetchMock = vi.fn((url: string) => Promise.resolve(jsonResponse(
      url === '/api/auth/me' ? { user: { id: actor } } : payload(actor),
    )))
    vi.stubGlobal('fetch', fetchMock)

    await expect(load()).resolves.toEqual([{ id: 'actor-a' }])
    actor = 'actor-b'
    await expect(load()).resolves.toEqual([{ id: 'actor-b' }])
    actor = 'actor-a'
    await expect(load()).resolves.toEqual([{ id: 'actor-a' }])
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/me')).toHaveLength(3)
    expect(fetchMock.mock.calls.filter(([url]) => url !== '/api/auth/me')).toHaveLength(2)
  })

  it('starts a fresh lookup after an awaited boundary while the older identity is still pending', async () => {
    const olderIdentity = deferred<Response>()
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') return Promise.resolve(jsonResponse({ user: { id: 'actor-b' } }))
      return Promise.resolve(jsonResponse({ classrooms: [{ id: 'actor-b-class' }] }))
    }).mockImplementationOnce(() => olderIdentity.promise)
    vi.stubGlobal('fetch', fetchMock)

    const earlierRead = fetchTeacherClassrooms()
    await Promise.resolve()
    await expect(fetchTeacherClassrooms()).resolves.toEqual([{ id: 'actor-b-class' }])
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/me')).toHaveLength(2)
    olderIdentity.resolve(jsonResponse({ user: { id: 'actor-a' } }))
    await earlierRead
  })

  it.each([
    { name: 'HTTP error', response: () => jsonResponse({ error: 'Unauthenticated' }, false) },
    { name: 'missing user', response: () => jsonResponse({}) },
    { name: 'invalid JSON', response: () => ({ ok: true, json: async () => { throw new Error('Bad JSON') } }) as Response },
  ])('does not cache an unverifiable identity after $name', async ({ response }) => {
    let identityResponse = response()
    let listNumber = 0
    const fetchMock = vi.fn((url: string) => Promise.resolve(
      url === '/api/auth/me'
        ? identityResponse
        : jsonResponse({ classrooms: [{ id: `class-${++listNumber}` }] }),
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(Promise.all([fetchTeacherClassrooms(), fetchTeacherClassrooms()]))
      .resolves.toEqual([[{ id: 'class-1' }], [{ id: 'class-2' }]])
    identityResponse = jsonResponse({ user: { id: 'actor-b' } })
    await expect(fetchTeacherClassrooms()).resolves.toEqual([{ id: 'class-3' }])
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/me')).toHaveLength(2)
  })

  it('shares network rejection within the batch and retries the next identity read', async () => {
    const identity = deferred<Response>()
    const fetchMock = vi.fn((url: string) => Promise.resolve(jsonResponse(
      url === '/api/auth/me' ? { user: { id: 'actor-b' } } : { blueprints: [] },
    ))).mockImplementationOnce(() => identity.promise)
    vi.stubGlobal('fetch', fetchMock)

    const reads = Promise.allSettled([fetchTeacherClassrooms(), fetchTeacherBlueprints()])
    identity.reject(new Error('Offline'))
    expect(await reads).toEqual([
      { status: 'rejected', reason: new Error('Offline') },
      { status: 'rejected', reason: new Error('Offline') },
    ])
    await expect(fetchTeacherBlueprints()).resolves.toEqual([])
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/me')).toHaveLength(2)
  })
})
