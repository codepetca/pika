import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/feedback/route'
import { getServiceRoleClient } from '@/lib/supabase'
import { recordDirectDeveloperFeedback } from '@/lib/developer-log-feedback'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({
    id: 'user-1',
    role: 'teacher',
  })),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => ({ from: vi.fn() })),
}))

vi.mock('@/lib/developer-log-feedback', () => ({
  recordDirectDeveloperFeedback: vi.fn(async () => ({ id: 'candidate-1' })),
}))

describe('POST /api/feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 for invalid request bodies', async () => {
    const response = await POST(
      new Request('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: '{invalid',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' })
  })

  it('returns 400 for invalid category and short descriptions', async () => {
    const invalidCategory = await POST(
      new Request('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          category: 'praise',
          description: 'This is a long enough description.',
          metadata: {},
        }),
      })
    )

    expect(invalidCategory.status).toBe(400)
    await expect(invalidCategory.json()).resolves.toEqual({ error: 'Invalid category' })

    const shortDescription = await POST(
      new Request('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          category: 'bug',
          description: 'Too short',
          metadata: {},
        }),
      })
    )

    expect(shortDescription.status).toBe(400)
    await expect(shortDescription.json()).resolves.toEqual({
      error: 'Description must be at least 10 characters',
    })
  })

  it('stores direct feedback in the developer feedback triage queue', async () => {
    const response = await POST(
      new Request('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          category: 'suggestion',
          description: 'Allow teachers to pin important assignment feedback.',
          metadata: {
            url: 'http://localhost:3000/classrooms/1?tab=assignments',
            userAgent: 'Vitest',
            version: '1.0.0',
            commit: 'abc123',
            env: 'test',
          },
        }),
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, candidate_id: 'candidate-1' })
    expect(getServiceRoleClient).toHaveBeenCalled()
    expect(recordDirectDeveloperFeedback).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'user-1',
        role: 'teacher',
        category: 'suggestion',
        description: 'Allow teachers to pin important assignment feedback.',
        metadata: {
          url: 'http://localhost:3000/classrooms/1?tab=assignments',
          userAgent: 'Vitest',
          version: '1.0.0',
          commit: 'abc123',
          env: 'test',
        },
      })
    )
  })
})
