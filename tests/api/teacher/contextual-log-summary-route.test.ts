import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/teacher/log-summary/route'
import { authorizeTeacherDailyReadActor } from '@/lib/server/contextual-teacher-daily-read'
import { readContextualTeacherLogSummary } from '@/lib/server/contextual-teacher-daily-summary'
import { mockAuthenticationError } from '../setup'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const serviceClient = { from: vi.fn() }
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => serviceClient) }))
vi.mock('@/lib/server/contextual-teacher-daily-read', () => ({ authorizeTeacherDailyReadActor: vi.fn() }))
vi.mock('@/lib/server/contextual-teacher-daily-summary', () => ({ readContextualTeacherLogSummary: vi.fn() }))

const request = (query = '') => new NextRequest(`http://localhost:3000/api/teacher/log-summary${query}`)

describe('contextual teacher Daily summary route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authorizeTeacherDailyReadActor).mockResolvedValue({
      mode: 'contextual', user: { id: actorId, role: 'student' } as never,
    })
    vi.mocked(readContextualTeacherLogSummary).mockResolvedValue({ summary: null, summary_status: 'pending' })
  })

  it('authenticates before parsing request input', async () => {
    vi.mocked(authorizeTeacherDailyReadActor).mockRejectedValueOnce(mockAuthenticationError())
    const response = await GET(request('?classroom_id=invalid&date=bad'))
    expect(response.status).toBe(401)
    expect(readContextualTeacherLogSummary).not.toHaveBeenCalled()
  })

  it('rejects malformed admitted queries with named schema before any data read', async () => {
    for (const query of ['', '?classroom_id=bad&date=2026-09-30', `?classroom_id=${classroomId}&date=bad`]) {
      const response = await GET(request(query))
      expect(response.status).toBe(400)
    }
    expect(readContextualTeacherLogSummary).not.toHaveBeenCalled()
    expect(serviceClient.from).not.toHaveBeenCalled()
  })

  it('passes the session actor and validated scope and returns helper status unchanged', async () => {
    const response = await GET(request(`?classroom_id=${classroomId}&date=2026-09-30`))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ summary: null, summary_status: 'pending' })
    expect(readContextualTeacherLogSummary).toHaveBeenCalledWith({
      supabase: serviceClient, actorId, classroomId, date: '2026-09-30',
    })
  })
})
