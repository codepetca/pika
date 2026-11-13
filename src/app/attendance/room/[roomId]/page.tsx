import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { resolveAttendanceProtocolCompatibility } from '@/lib/server/classroom-experience-admission'
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
  const teacher = user.role === 'teacher'
  if (teacher && (await resolveAttendanceProtocolCompatibility(user)).status !== 'admitted') redirect(`${path}/move`)
  return <RoomAttendanceCheckIn roomId={roomId} scanId={parsedScan.data ?? null} teacherMovePath={teacher ? `${path}/move` : undefined} />
}
