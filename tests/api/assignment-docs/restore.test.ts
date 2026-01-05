import { describe, it, expect, vi } from 'vitest'
import { POST } from '@/app/api/assignment-docs/[id]/restore/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'student-1', role: 'student' })) }))

describe('POST /api/assignment-docs/[id]/restore', () => {
  it('returns 400 when history_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/restore', {
      method: 'POST',
      body: JSON.stringify({})
    })

    const response = await POST(request, { params: { id: 'assign-1' } })
    expect(response.status).toBe(400)
  })
})
