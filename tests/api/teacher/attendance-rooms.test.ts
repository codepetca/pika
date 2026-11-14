import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ role: vi.fn(), owns: vi.fn(), access: vi.fn(), actor: vi.fn(), send: vi.fn(), configured: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherCanMutateClassroom: mocks.owns }))
vi.mock('@/lib/server/bara-attendance-scope', () => ({ assertBaraAttendanceClassroomAccess: mocks.access }))
vi.mock('@/lib/server/bara-attendance-teacher', () => ({ resolveVerifiedPikaAttendanceTeacher: mocks.actor }))
vi.mock('@/lib/server/bara-attendance-client', () => ({ isBaraRoomAttendanceConfigured: mocks.configured, postBaraRoomCommand: mocks.send, BaraAttendanceClientError: class extends Error { constructor(message: string, _code: string, _retryable: boolean, readonly status: number) { super(message) } } }))
import { POST } from '@/app/api/teacher/attendance/rooms/route'
import { BaraAttendanceClientError } from '@/lib/server/bara-attendance-client'

const classroom = '11111111-1111-4111-8111-111111111111'
function request(body: object) { return new NextRequest('https://pika.test/api/teacher/attendance/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }

describe('teacher room command boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configured.mockReturnValue(true)
    mocks.role.mockResolvedValue({ id: 'teacher', role: 'teacher' })
    mocks.owns.mockResolvedValue({ ok: true })
    mocks.access.mockResolvedValue(undefined)
    mocks.actor.mockResolvedValue({ displayName: 'Teacher', workosSubject: 'workos' })
    mocks.send.mockResolvedValue({ ok: true, revision: 3 })
    mocks.from.mockImplementation((table: string) => {
      const row = table === 'attendance_principal_mappings' ? { principal_ref: 'principal' } : table === 'attendance_roster_mappings' ? { roster_ref: 'roster' } : { occurrence_ref: 'occurrence' }
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: row, error: null }) }
      return query
    })
  })
  it('derives the roster, actor and occurrence from the authorized class', async () => {
    const response = await POST(request({ classroom_id: classroom, date: '2026-11-13', operation: 'move', room_id: 'room1234567890123456', save_default: true }))
    expect(response.status).toBe(200)
    expect(mocks.send).toHaveBeenCalledWith({ operation: 'move', roster_ref: 'roster', actor_principal_ref: 'principal', actor_display_name: 'Teacher', occurrence_ref: 'occurrence', room_id: 'room1234567890123456', save_default: true })
  })
  it('does not include occurrence on create when a date is selected', async () => {
    const response = await POST(request({ classroom_id: classroom, date: '2026-11-13', operation: 'create', label: 'Lab' }))
    expect(response.status).toBe(200)
    expect(mocks.send).toHaveBeenCalledWith({ operation: 'create', roster_ref: 'roster', actor_principal_ref: 'principal', actor_display_name: 'Teacher', label: 'Lab' })
  })
  it('rejects caller-supplied roster references and does not send a command', async () => {
    const response = await POST(request({ classroom_id: classroom, operation: 'list', roster_ref: 'other' }))
    expect(response.status).toBe(400)
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('returns a useful conflict without exposing provider detail', async () => {
    mocks.send.mockRejectedValue(new BaraAttendanceClientError('provider detail', 'conflict', false, 409))
    const response = await POST(request({ classroom_id: classroom, date: '2026-11-13', operation: 'move', room_id: 'room1234567890123456' }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Attendance changed or this meeting is not open. Refresh and try again' })
  })
  it('stops before provider access when classroom mutation is forbidden', async () => {
    mocks.owns.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const response = await POST(request({ classroom_id: classroom, operation: 'list' }))
    expect(response.status).toBe(403)
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
