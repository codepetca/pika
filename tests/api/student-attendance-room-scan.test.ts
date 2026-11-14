import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ user: vi.fn(), compatibility: vi.fn(), command: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/server/classroom-experience-admission', () => ({ resolveAttendanceProtocolCompatibility: mocks.compatibility }))
vi.mock('@/lib/server/bara-attendance-client', () => ({ postBaraRoomCommand: mocks.command }))
import { GET } from '@/app/attendance/room/[roomId]/scan/route'
const roomId = 'abcd1234abcd1234'
const params = Promise.resolve({ roomId })

describe('room QR capture', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue(null); mocks.command.mockResolvedValue({ ok: true, continuation: 'a'.repeat(40) }) })
  it('exchanges the proof and redirects to a clean URL with an HTTP-only bounded cookie', async () => {
    const response = await GET(new NextRequest(`https://pika.example/attendance/room/${roomId}/scan?proof=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`), { params })
    expect(response.status).toBe(303)
    const clean = new URL(response.headers.get('location')!)
    expect(clean.pathname).toBe(`/attendance/room/${roomId}`)
    expect(clean.searchParams.has('proof')).toBe(false)
    const cookie = response.cookies.get('pika_room_attendance')!
    expect(JSON.parse(cookie.value).scanId).toBe(clean.searchParams.get('scan'))
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/)
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=120/)
    expect(mocks.command).toHaveBeenCalledWith(expect.objectContaining({ operation: 'capture', room_id: roomId, proof: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', browser_key: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) }))
  })
  it('routes a teacher to move without capturing the proof', async () => {
    mocks.user.mockResolvedValue({ role: 'teacher' }); mocks.compatibility.mockResolvedValue({ status: 'legacy' })
    const response = await GET(new NextRequest(`https://pika.example/attendance/room/${roomId}/scan?proof=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`), { params })
    expect(response.headers.get('location')).toBe(`https://pika.example/attendance/room/${roomId}/move`)
    expect(mocks.command).not.toHaveBeenCalled()
  })
})
