import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { getUserDisplayInfo } from '@/lib/user-profile'
import { listActiveTeacherClassrooms } from '@/lib/server/classroom-order'
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

  if (user.role === 'teacher') {
    const [{ data: classrooms }, displayInfo] = await Promise.all([
      listActiveTeacherClassrooms(supabase, user.id),
      getUserDisplayInfo(user, supabase),
    ])

    return (
      <AppShell user={{ email: user.email, role: user.role, ...displayInfo }} pageTitle="Classrooms" mainClassName="flex-1 min-h-0 w-full max-w-7xl mx-auto px-4 py-3">
        <TeacherClassroomsIndex initialClassrooms={classrooms || []} />
      </AppShell>
    )
  }

  const [{ data: enrollments }, displayInfo] = await Promise.all([
    supabase
      .from('classroom_enrollments')
      .select('classroom_id')
      .eq('student_id', user.id),
    getUserDisplayInfo(user, supabase),
  ])

  const classroomIds = enrollments?.map(e => e.classroom_id) || []

  if (classroomIds.length === 0) {
    return (
      <AppShell user={{ email: user.email, role: user.role, ...displayInfo }} pageTitle="Classrooms" mainClassName="flex-1 min-h-0 w-full max-w-7xl mx-auto px-4 py-3">
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
