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
  it.each([null, { role: 'student' }])('clears stale capture for a proofless QR (%s)', async user => {
    mocks.user.mockResolvedValue(user)
    const response = await GET(new NextRequest(`https://pika.example/attendance/room/${roomId}/scan`, { headers: { cookie: 'pika_room_attendance=stale' } }), { params })
    expect(response.headers.get('location')).toBe(`https://pika.example/attendance/room/${roomId}`)
    expect(response.headers.get('set-cookie')).toMatch(/pika_room_attendance=;.*Expires=Thu, 01 Jan 1970/)
    expect(mocks.command).not.toHaveBeenCalled()
  })
  it('retains the rescan state when an otherwise valid proof has expired', async () => {
    mocks.command.mockResolvedValue({ ok: true, continuation: null })
    const response = await GET(new NextRequest(`https://pika.example/attendance/room/${roomId}/scan?proof=${'a'.repeat(64)}`, { headers: { cookie: 'pika_room_attendance=stale' } }), { params })
    expect(new URL(response.headers.get('location')!).searchParams.get('scan')).toMatch(/^[0-9a-f-]{36}$/)
    expect(response.headers.get('set-cookie')).toMatch(/pika_room_attendance=;.*Expires=Thu, 01 Jan 1970/)
  })
  it('retains the rescan state for malformed proof', async () => {
    const response = await GET(new NextRequest(`https://pika.example/attendance/room/${roomId}/scan?proof=bad`), { params })
    expect(new URL(response.headers.get('location')!).searchParams.get('scan')).toMatch(/^[0-9a-f-]{36}$/)
    expect(mocks.command).not.toHaveBeenCalled()
  })
  it('routes a teacher with no proof to move', async () => {
    mocks.user.mockResolvedValue({ role: 'teacher' })
    const response = await GET(new NextRequest(`https://pika.example/attendance/room/${roomId}/scan`), { params })
    expect(response.headers.get('location')).toBe(`https://pika.example/attendance/room/${roomId}/move`)
    expect(mocks.command).not.toHaveBeenCalled()
  })
  it('routes a teacher to move without capturing the proof', async () => {
    mocks.user.mockResolvedValue({ role: 'teacher' }); mocks.compatibility.mockResolvedValue({ status: 'legacy' })
    const response = await GET(new NextRequest(`https://pika.example/attendance/room/${roomId}/scan?proof=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`), { params })
    expect(response.headers.get('location')).toBe(`https://pika.example/attendance/room/${roomId}/move`)
    expect(mocks.command).not.toHaveBeenCalled()
  })
})
