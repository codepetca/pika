import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { getUserDisplayInfo } from '@/lib/user-profile'
import { AppShell } from '@/components/AppShell'
import { TeacherClassroomsIndex } from './TeacherClassroomsIndex'
import { StudentClassroomsIndex } from './StudentClassroomsIndex'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ClassroomsIndexPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  const supabase = getServiceRoleClient()

  // Fetch user display info (for avatar)
  const displayInfo = await getUserDisplayInfo(user, supabase)

  if (user.role === 'teacher') {
    const { data: classrooms } = await supabase
      .from('classrooms')
      .select('*')
      .eq('teacher_id', user.id)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })

    return (
      <AppShell user={{ email: user.email, role: user.role, ...displayInfo }}>
        <TeacherClassroomsIndex initialClassrooms={classrooms || []} />
      </AppShell>
    )
  }

  // Student: fetch all enrolled classrooms
  const { data: enrollments } = await supabase
    .from('classroom_enrollments')
    .select('classroom_id')
    .eq('student_id', user.id)

  const classroomIds = enrollments?.map(e => e.classroom_id) || []

  if (classroomIds.length === 0) {
    // No enrollments, show empty state
    return (
      <AppShell user={{ email: user.email, role: user.role, ...displayInfo }}>
        <StudentClassroomsIndex initialClassrooms={[]} />
      </AppShell>
    )
  }

  const { data: classrooms } = await supabase
    .from('classrooms')
    .select('*')
    .in('id', classroomIds)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })

  return (
    <AppShell user={{ email: user.email, role: user.role, ...displayInfo }}>
      <StudentClassroomsIndex initialClassrooms={classrooms || []} />
    </AppShell>
  )
}
