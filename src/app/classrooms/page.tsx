import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
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
    const { data: classrooms } = await supabase
      .from('classrooms')
      .select('*')
      .eq('teacher_id', user.id)
      .order('updated_at', { ascending: false })
    return <TeacherClassroomsIndex initialClassrooms={classrooms || []} />
  }

  // Student: fetch all enrolled classrooms
  const { data: enrollments } = await supabase
    .from('classroom_enrollments')
    .select('classroom_id')
    .eq('student_id', user.id)

  const classroomIds = enrollments?.map(e => e.classroom_id) || []

  if (classroomIds.length === 0) {
    // No enrollments, show empty state
    return <StudentClassroomsIndex initialClassrooms={[]} />
  }

  const { data: classrooms } = await supabase
    .from('classrooms')
    .select('*')
    .in('id', classroomIds)
    .order('updated_at', { ascending: false })

  return <StudentClassroomsIndex initialClassrooms={classrooms || []} />
}
