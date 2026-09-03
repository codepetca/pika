import { notFound } from 'next/navigation'
import { StudentAttendanceCheckIn } from '@/app/attendance/check-in/[token]/StudentAttendanceCheckIn'

export const dynamic = 'force-dynamic'

export default function StudentClassroomAttendanceFixturePage() {
  if (process.env.NODE_ENV === 'production' && process.env.PIKA_E2E_FIXTURES !== 'true') {
    notFound()
  }

  return (
    <StudentAttendanceCheckIn
      entryToken={'a'.repeat(43)}
      canCheckIn
      mode="classroom"
    />
  )
}
