import { cookies } from 'next/headers'
import { roomCookieName, roomCookieSchema } from '@/lib/server/room-attendance-student'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { RoomAttendanceCheckIn } from './RoomAttendanceCheckIn'

export const dynamic = 'force-dynamic'
export default async function RoomPage({ params, searchParams }: {
  params: Promise<{ roomId: string }>
  searchParams: Promise<{ scan?: string }>
}) {
  const { roomId } = await params
  const parsedScan = z.string().uuid().safeParse((await searchParams).scan)
  const path = `/attendance/room/${encodeURIComponent(roomId)}`
  const user = await getCurrentUser()
  if (!user) {
    const next = parsedScan.success ? `${path}?scan=${parsedScan.data}` : path
    redirect(`/login?next=${encodeURIComponent(next)}`)
  }
  if (user.role === 'teacher') redirect(`${path}/move`)
  let raw: unknown
  try { raw = JSON.parse((await cookies()).get(roomCookieName)?.value ?? 'null') } catch { raw = null }
  const cookie = roomCookieSchema.safeParse(raw)
  const poster = cookie.success && cookie.data.poster === true && cookie.data.roomId === roomId
    && parsedScan.success && cookie.data.scanId === parsedScan.data
  return <RoomAttendanceCheckIn roomId={roomId} scanId={parsedScan.data ?? null} requireConfirmation={poster} />
}
