import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { loadStudentAttendanceEntryClassroomName } from '@/lib/server/student-attendance-entry-context'
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

  const classroomName = user.role === 'student'
    ? await loadStudentAttendanceEntryClassroomName({ supabase: getServiceRoleClient(), pikaUser: user, entryToken: token })
    : undefined
  return <StudentAttendanceCheckIn entryToken={token} canCheckIn={user.role === 'student'} classroomName={classroomName} />
}
