import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { getUserDisplayInfo } from '@/lib/user-profile'
import { ClassroomPageClient } from './ClassroomPageClient'
import type { Classroom } from '@/types'

// Force dynamic rendering (no caching) since data is user-specific
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: Promise<{ classroomId: string }>
  searchParams: Promise<{ tab?: string }>
}

export default async function ClassroomPage({ params, searchParams }: PageProps) {
  const { classroomId } = await params
  const { tab } = await searchParams

  // 1. Auth check - runs on server
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login')
  }

  const supabase = getServiceRoleClient()

  // 2. Fetch data based on role - runs on server
  if (user.role === 'teacher') {
    // Parallel fetch: current classroom + all teacher's classrooms + display info
    const [classroomResult, classroomsResult, displayInfo] = await Promise.all([
      supabase
        .from('classrooms')
        .select('*')
        .eq('id', classroomId)
        .eq('teacher_id', user.id)
        .single(),
      supabase
        .from('classrooms')
        .select('*')
        .eq('teacher_id', user.id)
        .is('archived_at', null)
        .order('updated_at', { ascending: false }),
      getUserDisplayInfo(user, supabase),
    ])

    if (classroomResult.error || !classroomResult.data) {
      notFound()
    }

    const classroom = classroomResult.data as Classroom
    const allClassrooms = (classroomsResult.data || []) as Classroom[]

    // If viewing archived classroom, only show that one in sidebar
    const teacherClassrooms = classroom.archived_at
      ? [classroom]
      : allClassrooms

    // 3. Render with data already loaded - no spinner needed!
    return (
      <ClassroomPageClient
        classroom={classroom}
        user={{
          id: user.id,
          email: user.email,
          role: user.role,
          ...displayInfo,
        }}
        teacherClassrooms={teacherClassrooms}
        initialTab={tab}
      />
    )
  }

  // Student flow
  // Parallel fetch: enrollment check + display info
  const [enrollmentResult, displayInfo] = await Promise.all([
    supabase
      .from('classroom_enrollments')
      .select('classroom_id')
      .eq('student_id', user.id)
      .eq('classroom_id', classroomId)
      .single(),
    getUserDisplayInfo(user, supabase),
  ])

  if (!enrollmentResult.data) {
    notFound() // Not enrolled in this classroom
  }

  // Fetch the classroom
  const { data: classroom, error } = await supabase
    .from('classrooms')
    .select('*')
    .eq('id', classroomId)
    .is('archived_at', null)
    .single()

  if (error || !classroom) {
    notFound()
  }

  return (
    <ClassroomPageClient
      classroom={classroom as Classroom}
      user={{
        id: user.id,
        email: user.email,
        role: user.role,
        ...displayInfo,
      }}
      teacherClassrooms={[]} // Students don't need this
      initialTab={tab}
    />
  )
}
