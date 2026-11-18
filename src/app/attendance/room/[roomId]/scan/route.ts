import { randomBytes, randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { postBaraRoomCommand } from '@/lib/server/bara-attendance-client'
import { roomCookieName, roomIdSchema } from '@/lib/server/room-attendance-student'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params
  const user = await getCurrentUser()
  if (user?.role === 'teacher') {
    const move = NextResponse.redirect(new URL(`/attendance/room/${encodeURIComponent(roomId)}/move`, request.url), 303)
    move.headers.set('Cache-Control', 'no-store')
    move.headers.set('Referrer-Policy', 'no-referrer')
    return move
  }
  const proof = request.nextUrl.searchParams.get('proof')
  const target = new URL(`/attendance/room/${encodeURIComponent(roomId)}`, request.url)
  const scanId = proof === null ? null : randomUUID()
  if (scanId) target.searchParams.set('scan', scanId)
  const response = NextResponse.redirect(target, 303)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.cookies.delete(roomCookieName)
  if (proof === null || !scanId || !roomIdSchema.safeParse(roomId).success || !/^[a-f0-9]{64}$/.test(proof)) return response
  const browserKey = randomBytes(32).toString('base64url')
  try {
    const result = await postBaraRoomCommand({ operation: 'capture', room_id: roomId, proof, browser_key: browserKey })
    if (result.continuation && /^[A-Za-z0-9_-]{40}$/.test(result.continuation)) {
      response.cookies.set(roomCookieName, JSON.stringify({ roomId, scanId, continuation: result.continuation, browserKey }), {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 120,
      })
    }
  } catch { /* The clean destination offers a fresh scan. */ }
  return response
}
