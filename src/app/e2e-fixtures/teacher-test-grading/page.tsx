import { notFound } from 'next/navigation'
import { TeacherTestsTab } from '@/app/classrooms/[classroomId]/TeacherTestsTab'
import { DEFAULT_CLASSROOM_FEATURE_VISIBILITY } from '@/lib/classroom-feature-visibility'
import { DEFAULT_ACTUAL_COURSE_SITE_CONFIG } from '@/lib/course-site-publishing'
import type { Classroom } from '@/types'
import { PageDensityProvider } from '@/ui'

export const dynamic = 'force-dynamic'

const classroom: Classroom = {
  id: '30000000-0000-4000-8000-000000000011',
  teacher_id: '30000000-0000-4000-8000-000000000012',
  title: 'Test Grading Fixture',
  class_code: 'TEST-GRADING-FIXTURE',
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

export default function TeacherTestGradingFixturePage() {
  if (process.env.NODE_ENV === 'production' && process.env.PIKA_E2E_FIXTURES !== 'true') {
    notFound()
  }

  return (
    <main className="flex h-screen min-h-0 flex-col px-3 pb-3">
      <PageDensityProvider density="teacher">
        <TeacherTestsTab
          classroom={classroom}
          selectedTestId="30000000-0000-4000-8000-000000000013"
          selectedTestMode="grading"
        />
      </PageDensityProvider>
    </main>
  )
}
