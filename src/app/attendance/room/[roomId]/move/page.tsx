import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { MoveRoom } from './MoveRoom'

export const dynamic = 'force-dynamic'
export default async function MoveAttendanceRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params
  const path = `/attendance/room/${encodeURIComponent(roomId)}/move`
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`)
  if (user.role !== 'teacher') redirect('/classrooms')
  return <MoveRoom roomId={roomId} />
}
