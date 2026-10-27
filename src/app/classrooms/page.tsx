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
import { isContextualClassroomHomeAdmitted, loadContextualClassroomHome } from '@/lib/server/contextual-classroom-home'
import { resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { readClassroomHomeVisibility } from '@/lib/server/classroom-home-visibility'
import { loadClassroomHomeCreationAccess } from '@/lib/server/classroom-home-creation'
import type { ClassroomHomePresentation } from '@/lib/contracts/classroom-home'
import type { Classroom } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ClassroomsIndexPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect(await getServerLoginRedirectPath())
  }

  const supabase = getServiceRoleClient()

  if ((await isContextualClassroomHomeAdmitted(user))
    && (await resolveClassroomExperienceAdmission(user)).status === 'admitted') {
    const displayInfo = await getUserDisplayInfo(user, supabase)
    let initialClassrooms: Classroom[] = []
    let initialReadError = false
    let contextualHome: ClassroomHomePresentation = {
      joined: [], hidden: [], canCreate: false, canImportBlueprint: user.role === 'teacher',
    }
    try {
      const [home, visibility, creation] = await Promise.all([
        loadContextualClassroomHome(user.id, { supabase }),
        readClassroomHomeVisibility({ supabase, actorId: user.id }),
        loadClassroomHomeCreationAccess(user.id, supabase),
      ])
      const hidden = new Set(visibility.hidden_enrollment_ids)
      initialClassrooms = hydrateClassroomRecords(home.owned)
      contextualHome = {
        joined: home.joined.filter(row => !row.enrollment_id || !hidden.has(row.enrollment_id)),
        hidden: home.joined.filter(row => row.enrollment_id && hidden.has(row.enrollment_id)),
        canCreate: creation.canCreate,
        canImportBlueprint: user.role === 'teacher',
      }
    } catch {
      // Never substitute the legacy role-based view for uncertain live state.
      initialReadError = true
    }
    return (
      <AppShell initialNow={Date.now()} user={{ id: user.id, email: user.email, role: user.role, ...displayInfo }} pageTitle="Classrooms" mainClassName="flex-1 min-h-0 w-full max-w-7xl mx-auto px-4 py-3">
        <TeacherClassroomsIndex initialClassrooms={initialClassrooms} initialReadError={initialReadError} contextualHome={contextualHome} />
      </AppShell>
    )
  }

  if (user.role === 'teacher') {
    const [{ data: classrooms, error }, displayInfo] = await Promise.all([
      listActiveTeacherClassrooms(supabase, user.id),
      getUserDisplayInfo(user, supabase),
    ])

    return (
      <AppShell initialNow={Date.now()} user={{ id: user.id, email: user.email, role: user.role, ...displayInfo }} pageTitle="Classrooms" mainClassName="flex-1 min-h-0 w-full max-w-7xl mx-auto px-4 py-3">
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
      <AppShell initialNow={Date.now()} user={{ id: user.id, email: user.email, role: user.role, ...displayInfo }} pageTitle="Classrooms" mainClassName="flex-1 min-h-0 w-full max-w-7xl mx-auto px-4 py-3">
        <StudentClassroomsIndex initialClassrooms={[]} initialReadError studentId={user.id} />
      </AppShell>
    )
  }

  const classroomIds = enrollments?.map(e => e.classroom_id) || []

  if (classroomIds.length === 0) {
    return (
      <AppShell initialNow={Date.now()} user={{ id: user.id, email: user.email, role: user.role, ...displayInfo }} pageTitle="Classrooms" mainClassName="flex-1 min-h-0 w-full max-w-7xl mx-auto px-4 py-3">
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
    <AppShell initialNow={Date.now()} user={{ id: user.id, email: user.email, role: user.role, ...displayInfo }}>
      <StudentClassroomsIndex
        initialClassrooms={classroomError ? [] : hydrateClassroomRecords((classrooms || []).map(classroomStudentRecord))}
        initialReadError={Boolean(classroomError)}
        studentId={user.id}
      />
      {palAvailable ? <StudentPalAmbientSurfaces scopeKey="classrooms-index" /> : null}
    </AppShell>
  )
}
