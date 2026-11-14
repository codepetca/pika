import { notFound } from 'next/navigation'
import { TeacherRoomFixture } from './TeacherRoomFixture'
import { RoomAttendanceCheckIn } from '@/app/attendance/room/[roomId]/RoomAttendanceCheckIn'
import { MoveRoom } from '@/app/attendance/room/[roomId]/move/MoveRoom'

export const dynamic = 'force-dynamic'
const roomId = 'room1234567890123456'
export default async function AttendanceRoomFixture({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.NODE_ENV === 'production' && process.env.PIKA_E2E_FIXTURES !== 'true') notFound()
  const { view } = await searchParams
  if (view === 'closed') return <RoomAttendanceCheckIn roomId={roomId} scanId={null} />
  if (view === 'student') return <RoomAttendanceCheckIn roomId={roomId} scanId="30000000-0000-4000-8000-000000000003" />
  if (view === 'move') return <MoveRoom roomId={roomId} />
  return <main><TeacherRoomFixture /></main>
}
