import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler } from '@/lib/api-handler'
import { requireAuth, requireRole } from '@/lib/auth'
import { resolveAttendanceProtocolCompatibility } from '@/lib/server/classroom-experience-admission'
import { checkInRoom, roomCookieName, roomCookieSchema, roomIdSchema } from '@/lib/server/room-attendance-student'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const POST = withErrorHandler('PostStudentRoomAttendanceCheckIn', async request => {
  const auth = await requireAuth()
  const user = (await resolveAttendanceProtocolCompatibility(auth)).status === 'admitted' ? auth : await requireRole('student')
  const body = z.object({ roomId: roomIdSchema, scanId: z.string().uuid(), attemptId: z.string().uuid() }).strict().parse(await request.json())
  let raw: unknown
  try { raw = JSON.parse((await cookies()).get(roomCookieName)?.value ?? 'null') } catch { raw = null }
  const cookie = roomCookieSchema.safeParse(raw)
  if (!cookie.success || cookie.data.roomId !== body.roomId || cookie.data.scanId !== body.scanId) return NextResponse.json({ results: null }, { headers: { 'Cache-Control': 'no-store' } })
  const results = await checkInRoom({ supabase: getServiceRoleClient(), pikaUser: user, ...cookie.data, attemptId: body.attemptId })
  return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
})
