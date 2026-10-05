import { StudentPalAmbientSurfaces } from '@/integrations/pal'
import { getPalApiUrl } from '@/lib/server/pal-config'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { getUserDisplayInfo } from '@/lib/user-profile'
import { listActiveTeacherClassrooms } from '@/lib/server/classroom-order'
import { getServerLoginRedirectPath } from '@/lib/server/auth-redirect'
import { classroomStudentRecord, hydrateClassroomRecords } from '@/lib/server/classrooms'
import { AppShell } from '@/components/AppShell'
import { TeacherClassroomsIndex } from './TeacherClassroomsIndex'
import { StudentClassroomsIndex } from './StudentClassroomsIndex'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ClassroomsIndexPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect(await getServerLoginRedirectPath())
  }

  const supabase = getServiceRoleClient()

  if (user.role === 'teacher') {
    const [{ data: classrooms, error }, displayInfo] = await Promise.all([
      listActiveTeacherClassrooms(supabase, user.id),
      getUserDisplayInfo(user, supabase),
    ])

    return (
      <AppShell user={{ id: user.id, email: user.email, role: user.role, ...displayInfo }} pageTitle="Classrooms" mainClassName="flex-1 min-h-0 w-full max-w-7xl mx-auto px-4 py-3">
        <TeacherClassroomsIndex
          initialClassrooms={error ? [] : hydrateClassroomRecords((classrooms || []) as Record<string, any>[])}
          initialReadError={Boolean(error)}
        />
      </AppShell>
    )
  }

  const [{ data: enrollments, error: enrollmentError }, displayInfo] = await Promise.all([
    supabase
      .from('classroom_enrollments')
      .select('classroom_id')
      .eq('student_id', user.id),
    getUserDisplayInfo(user, supabase),
  ])

  const palAvailable = Boolean(getPalApiUrl())

  if (enrollmentError) {
    return (
      <AppShell user={{ id: user.id, email: user.email, role: user.role, ...displayInfo }} pageTitle="Classrooms" mainClassName="flex-1 min-h-0 w-full max-w-7xl mx-auto px-4 py-3">
        <StudentClassroomsIndex initialClassrooms={[]} initialReadError studentId={user.id} />
      </AppShell>
    )
  }

  const classroomIds = enrollments?.map(e => e.classroom_id) || []

  if (classroomIds.length === 0) {
    return (
      <AppShell user={{ id: user.id, email: user.email, role: user.role, ...displayInfo }} pageTitle="Classrooms" mainClassName="flex-1 min-h-0 w-full max-w-7xl mx-auto px-4 py-3">
        <StudentClassroomsIndex initialClassrooms={[]} studentId={user.id} />
        {palAvailable ? <StudentPalAmbientSurfaces scopeKey="classrooms-index" /> : null}
      </AppShell>
    )
  }

  const { data: classrooms, error: classroomError } = await supabase
    .from('classrooms')
    .select('*')
    .in('id', classroomIds)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })

  return (
    <AppShell user={{ id: user.id, email: user.email, role: user.role, ...displayInfo }}>
      <StudentClassroomsIndex
        initialClassrooms={classroomError ? [] : hydrateClassroomRecords((classrooms || []).map(classroomStudentRecord))}
        initialReadError={Boolean(classroomError)}
        studentId={user.id}
      />
      {palAvailable ? <StudentPalAmbientSurfaces scopeKey="classrooms-index" /> : null}
    </AppShell>
  )
}
