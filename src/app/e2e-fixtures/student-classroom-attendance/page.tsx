import { notFound } from 'next/navigation'
import { StudentAttendanceCheckIn } from '@/app/attendance/check-in/[token]/StudentAttendanceCheckIn'

export const dynamic = 'force-dynamic'

export default async function StudentClassroomAttendanceFixturePage({
  searchParams,
}: {
  searchParams?: Promise<{ role?: string; mode?: string }>
} = {}) {
  if (process.env.NODE_ENV === 'production' && process.env.PIKA_E2E_FIXTURES !== 'true') {
    notFound()
  }

  const params = await searchParams

  return (
    <StudentAttendanceCheckIn
      entryToken={'a'.repeat(43)}
      canCheckIn={params?.role !== 'teacher'}
      mode={params?.mode === 'occurrence' ? 'occurrence' : 'classroom'}
      classroomName="PPZ3C — Health for Life"
    />
  )
}
