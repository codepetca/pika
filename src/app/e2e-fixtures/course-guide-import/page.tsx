import { notFound } from 'next/navigation'
import { CourseGuidePanel } from '@/components/CourseGuidePanel'
import { DEFAULT_CLASSROOM_FEATURE_VISIBILITY } from '@/lib/classroom-feature-visibility'
import { DEFAULT_ACTUAL_COURSE_SITE_CONFIG } from '@/lib/course-site-publishing'
import type { Classroom } from '@/types'
import { AppMessageProvider, TooltipProvider } from '@/ui'

export const dynamic = 'force-dynamic'

const classroom: Classroom = {
  id: '30000000-0000-4000-8000-000000000021',
  teacher_id: '30000000-0000-4000-8000-000000000022',
  title: 'Computer Studies 11',
  class_code: 'COURSE-GUIDE-FIXTURE',
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
  course_overview_markdown: 'Teacher-authored course purpose and local classroom context.',
  course_outline_markdown: '',
  archived_at: null,
  created_at: '2026-08-28T12:00:00.000Z',
  updated_at: '2026-08-28T12:00:00.000Z',
}

export default function CourseGuideImportFixturePage({
  searchParams,
}: {
  searchParams: { role?: string }
}) {
  if (process.env.NODE_ENV === 'production' && process.env.PIKA_E2E_FIXTURES !== 'true') {
    notFound()
  }
  const role = searchParams.role === 'student' ? 'student' : 'teacher'

  return (
    <main className="flex h-screen min-h-0 flex-col bg-page">
      <AppMessageProvider>
        <TooltipProvider>
          <CourseGuidePanel classroom={classroom} role={role} />
        </TooltipProvider>
      </AppMessageProvider>
    </main>
  )
}
