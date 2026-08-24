import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { StudentAttendanceCheckIn } from './StudentAttendanceCheckIn'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function AttendanceCheckInPage({ params }: PageProps) {
  const { token } = await params
  const entryPath = `/attendance/check-in/${token}`
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(entryPath)}`)

  return <StudentAttendanceCheckIn
    entryToken={token}
    canCheckIn={user.role === 'student'}
    studentId={user.role === 'student' ? user.id : undefined}
  />
}
