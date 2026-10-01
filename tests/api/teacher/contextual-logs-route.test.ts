import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/teacher/logs/route'
import { authorizeTeacherDailyReadActor } from '@/lib/server/contextual-teacher-daily-read'
import { readContextualTeacherLogs } from '@/lib/server/contextual-teacher-daily-logs'
import { mockAuthenticationError } from '../setup'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const service = { from: vi.fn() }
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => service) }))
vi.mock('@/lib/server/contextual-teacher-daily-read', () => ({ authorizeTeacherDailyReadActor: vi.fn() }))
vi.mock('@/lib/server/contextual-teacher-daily-logs', () => ({ readContextualTeacherLogs: vi.fn() }))

describe('contextual teacher logs route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authorizeTeacherDailyReadActor).mockResolvedValue({
      mode: 'contextual', user: { id: actorId, role: 'student' } as never,
    })
  })

  it('routes an admitted owner through the contextual read and preserves the legacy response envelope', async () => {
    const payload = { classroom_id: classroomId, date: '2026-10-01', logs: [] }
    vi.mocked(readContextualTeacherLogs).mockResolvedValue(payload)
    const response = await GET(new NextRequest(`http://localhost/api/teacher/logs?classroom_id=${classroomId}&date=2026-10-01`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(payload)
    expect(readContextualTeacherLogs).toHaveBeenCalledWith({
      supabase: service, actorId, classroomId, date: '2026-10-01',
    })
    expect(service.from).not.toHaveBeenCalled()
  })

  it('authenticates before parsing input and rejects invalid contextual IDs and dates', async () => {
    vi.mocked(authorizeTeacherDailyReadActor).mockRejectedValueOnce(mockAuthenticationError())
    const unauthenticated = await GET(new NextRequest('http://localhost/api/teacher/logs?classroom_id=bad&date=bad'))
    expect(unauthenticated.status).toBe(401)
    const invalidId = await GET(new NextRequest('http://localhost/api/teacher/logs?classroom_id=bad'))
    expect(invalidId.status).toBe(400)
    const invalidDate = await GET(new NextRequest(`http://localhost/api/teacher/logs?classroom_id=${classroomId}&date=bad`))
    expect(invalidDate.status).toBe(400)
    expect(readContextualTeacherLogs).not.toHaveBeenCalled()
    expect(service.from).not.toHaveBeenCalled()
  })
})
