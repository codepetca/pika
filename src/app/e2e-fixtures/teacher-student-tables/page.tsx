import { notFound } from 'next/navigation'
import { ClassroomPageClient } from '@/app/classrooms/[classroomId]/ClassroomPageClient'
import { DEFAULT_CLASSROOM_FEATURE_VISIBILITY } from '@/lib/classroom-feature-visibility'
import { DEFAULT_ACTUAL_COURSE_SITE_CONFIG } from '@/lib/course-site-publishing'
import type { Classroom } from '@/types'
import { LayoutInitialStateProvider } from '@/components/layout'
import { CourseGuideContinuityFixture } from './course-guide-continuity'

export const dynamic = 'force-dynamic'

const classroom: Classroom = {
  id: '30000000-0000-4000-8000-000000000011',
  teacher_id: '30000000-0000-4000-8000-000000000012',
  title: 'Student Table Layout Fixture', class_code: 'STUDENT-TABLE-FIXTURE',
  theme_color: 'blue', term_label: null, allow_enrollment: true, join_policy: 'roster',
  start_date: null, end_date: null, lesson_plan_visibility: 'current_week',
  feature_visibility: { ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, attendance: true },
  blueprint_source_revision: 1, source_blueprint_id: null, source_blueprint_origin: null,
  actual_site_slug: null, actual_site_published: false, actual_site_config: DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
  course_overview_markdown: '', course_outline_markdown: '', archived_at: null,
  created_at: '2026-08-17T12:00:00Z', updated_at: '2026-08-17T12:00:00Z',
}

/** Production layout owners with synthetic identities; API authorization is unchanged. */
export default async function TeacherStudentTablesFixture({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.PIKA_E2E_FIXTURES !== 'true') notFound()
  const query = await searchParams
  const role = query.role === 'student' ? 'student' : 'teacher'
  if (query.guideContinuity === 'true') {
    return (
      <LayoutInitialStateProvider leftSidebarExpanded>
        <CourseGuideContinuityFixture classroom={classroom} initialRole={role} query={query} />
      </LayoutInitialStateProvider>
    )
  }
  const fixtureClassroom = role === 'student' && query.grades === 'true'
    ? { ...classroom, feature_visibility: { ...classroom.feature_visibility, student_grades: true } }
    : classroom
  return (
    <LayoutInitialStateProvider leftSidebarExpanded>
      <ClassroomPageClient initialNow={Date.parse('2026-10-05T16:00:00Z')}
        classroom={fixtureClassroom}
        user={{ id: role === 'teacher' ? classroom.teacher_id : '30000000-0000-4000-8000-000000000015',
          email: `${role}@example.invalid`, role, first_name: 'Fixture', last_name: role }}
        classroomRole={role}
        teacherClassrooms={role === 'teacher' ? [classroom] : []}
        initialSearchParams={query}
        attendanceAvailable
        classroomQrAvailable
      />
    </LayoutInitialStateProvider>
  )
}
