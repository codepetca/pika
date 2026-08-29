import { notFound } from 'next/navigation'
import { StudentTestsTab } from '@/app/classrooms/[classroomId]/StudentTestsTab'
import { StudentNotificationsProvider } from '@/components/StudentNotificationsProvider'
import { DEFAULT_CLASSROOM_FEATURE_VISIBILITY } from '@/lib/classroom-feature-visibility'
import { DEFAULT_ACTUAL_COURSE_SITE_CONFIG } from '@/lib/course-site-publishing'
import type { Classroom } from '@/types'
import { PageDensityProvider } from '@/ui'

export const dynamic = 'force-dynamic'

const classroom: Classroom = {
  id: '30000000-0000-4000-8000-000000000021',
  teacher_id: '30000000-0000-4000-8000-000000000022',
  title: 'Student Test List Fixture',
  class_code: 'STUDENT-TEST-LIST',
  theme_color: 'blue',
  term_label: null,
  allow_enrollment: true,
  join_policy: 'roster',
  start_date: null,
  end_date: null,
  lesson_plan_visibility: 'current_week',
  feature_visibility: DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
  blueprint_source_revision: 1,
  source_blueprint_id: null,
  source_blueprint_origin: null,
  actual_site_slug: null,
  actual_site_published: false,
  actual_site_config: DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
  course_overview_markdown: '',
  course_outline_markdown: '',
  archived_at: null,
  created_at: '2026-08-27T12:00:00.000Z',
  updated_at: '2026-08-27T12:00:00.000Z',
}

export default function StudentTestListFixturePage() {
  if (process.env.NODE_ENV === 'production' && process.env.PIKA_E2E_FIXTURES !== 'true') {
    notFound()
  }

  return (
    <main className="min-h-screen bg-page px-4 py-6">
      <PageDensityProvider density="student">
        <StudentNotificationsProvider
          classroomId={classroom.id}
          featureVisibility={classroom.feature_visibility}
        >
          <StudentTestsTab classroom={classroom} />
        </StudentNotificationsProvider>
      </PageDensityProvider>
    </main>
  )
}
