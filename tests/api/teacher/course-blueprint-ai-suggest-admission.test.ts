import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-handler'
import { POST } from '@/app/api/teacher/course-blueprints/[id]/ai/suggest/route'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getDetail: vi.fn(),
  generate: vi.fn(),
  acquire: vi.fn(),
  createToken: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/server/course-blueprints', () => ({ getCourseBlueprintDetail: mocks.getDetail }))
vi.mock('@/lib/server/course-blueprint-guided-drafting', () => ({
  generateCourseBlueprintGuidedDraft: mocks.generate,
}))
vi.mock('@/lib/server/course-blueprint-draft-admission', () => ({
  acquireCourseBlueprintDraftSlot: mocks.acquire,
}))
vi.mock('@/lib/server/course-blueprint-draft-provenance', () => ({
  createCourseBlueprintDraftProvenanceToken: mocks.createToken,
}))

function request(target: 'tests' | 'assignments' = 'tests') {
  return new NextRequest('http://localhost/api/teacher/course-blueprints/blueprint-1/ai/suggest', {
    method: 'POST',
    body: JSON.stringify({ target, prompt: 'Draft a new assessment' }),
  })
}

function context() {
  return { params: Promise.resolve({ id: 'blueprint-1' }) }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireRole.mockResolvedValue({ id: 'teacher-1' })
  mocks.getDetail.mockResolvedValue({
    detail: {
      authoring_guidance: { unit_exceptions: [] },
      content_revision: 7,
    },
  })
  mocks.createToken.mockReturnValue('signed-draft-token')
  mocks.generate.mockResolvedValue({
    content: 'A guided draft',
    guidance: { blueprint_revision: 7, trial: false },
  })
})

describe('Blueprint guided draft admission', () => {
  it('rejects concurrent and repeated requests with 429 before calling the provider', async () => {
    let finishFirst: ((value: unknown) => void) | undefined
    const pendingFirst = new Promise((resolve) => { finishFirst = resolve })
    const release = vi.fn().mockResolvedValue(undefined)
    mocks.acquire
      .mockResolvedValueOnce(release)
      .mockRejectedValueOnce(new ApiError(429, 'An AI draft is already running for this teacher.'))
      .mockRejectedValueOnce(new ApiError(429, 'Too many AI drafts. Try again in a few minutes.'))
    mocks.generate.mockReturnValueOnce(pendingFirst)

    const first = POST(request(), context())
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1))
    const concurrent = await POST(request('assignments'), context())
    expect(concurrent.status).toBe(429)
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(release).not.toHaveBeenCalled()

    finishFirst?.({
      content: 'A guided draft',
      guidance: { blueprint_revision: 7, trial: false },
    })
    expect((await first).status).toBe(200)
    expect(release).toHaveBeenCalledTimes(1)

    const repeated = await POST(request(), context())
    expect(repeated.status).toBe(429)
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(mocks.acquire).toHaveBeenCalledTimes(3)
  })

  it('releases admission after provider failure and never issues provenance', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    mocks.acquire.mockResolvedValue(release)
    mocks.generate.mockRejectedValue(new Error('provider failed'))

    const response = await POST(request(), context())

    expect(response.status).toBe(500)
    expect(release).toHaveBeenCalledTimes(1)
    expect(mocks.createToken).not.toHaveBeenCalled()
  })

  it('does not reserve a slot when the selected unit guidance is stale', async () => {
    mocks.acquire.mockResolvedValue(vi.fn())
    const response = await POST(new NextRequest(
      'http://localhost/api/teacher/course-blueprints/blueprint-1/ai/suggest', {
        method: 'POST',
        body: JSON.stringify({
          target: 'tests', prompt: '',
          unit_exception_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        }),
      },
    ), context())

    expect(response.status).toBe(409)
    expect(mocks.acquire).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })
})
