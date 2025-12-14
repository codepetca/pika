import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { TeacherClassroomsIndex } from './TeacherClassroomsIndex'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ClassroomsIndexPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  const supabase = getServiceRoleClient()

  if (user.role === 'teacher') {
    const { data: classrooms } = await supabase
      .from('classrooms')
      .select('*')
      .eq('teacher_id', user.id)
      .order('updated_at', { ascending: false })
    return <TeacherClassroomsIndex initialClassrooms={classrooms || []} />
  }

  const { data: enrollments } = await supabase
    .from('classroom_enrollments')
    .select('classroom_id, created_at')
    .eq('student_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)

  const mostRecentEnrollment = enrollments?.[0]
  if (!mostRecentEnrollment) {
    redirect('/join')
  }

  redirect(`/classrooms/${mostRecentEnrollment.classroom_id}?tab=today`)
}
