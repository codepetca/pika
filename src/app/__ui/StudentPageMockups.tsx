'use client'

import { useState } from 'react'
import { addWeeks, format, subWeeks } from 'date-fns'
import { BookOpen, ChevronRight, FileText, Link as LinkIcon } from 'lucide-react'
import { AnnouncementContent } from '@/components/AnnouncementContent'
import { DateNavigator } from '@/components/DateNavigator'
import { LessonCalendar } from '@/components/LessonCalendar'
import { StudentTestListItem } from '@/components/StudentTestListItem'
import { TeacherWorkSurfaceContextBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceContextBar'
import { DEFAULT_CLASSROOM_FEATURE_VISIBILITY } from '@/lib/classroom-feature-visibility'
import { DEFAULT_ACTUAL_COURSE_SITE_CONFIG } from '@/lib/course-site-publishing'
import type { StudentTestSummary } from '@/lib/student-test-presentation'
import type { Classroom, ClassDay, LessonPlan, TiptapContent } from '@/types'
import { Button, Card, SaveStatus } from '@/ui'

export type StudentPageId = 'today' | 'classwork' | 'tests' | 'calendar' | 'announcements' | 'resources'

export const STUDENT_PAGE_ITEMS = [
  { value: 'today', label: 'Today' },
  { value: 'classwork', label: 'Classwork' },
  { value: 'tests', label: 'Tests' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'announcements', label: 'Announcements' },
  { value: 'resources', label: 'Resources' },
] as const

const STUDENT_TESTS: StudentTestSummary[] = [
  { title: 'Ecosystems test', status: 'active', student_status: 'not_started', effective_access: 'open' },
  { title: 'Cells checkpoint', status: 'active', student_status: 'responded', effective_access: 'open' },
  { title: 'Lab safety review', status: 'closed', student_status: 'can_view_results', effective_access: 'closed' },
]

const STUDENT_CLASSROOM: Classroom = {
  id: 'pattern-student-classroom', teacher_id: 'pattern-teacher', title: 'Grade 10 Science', class_code: 'SCI2D',
  theme_color: 'blue', term_label: 'Semester 1', allow_enrollment: true, join_policy: 'roster',
  start_date: '2026-09-01', end_date: '2027-01-29', lesson_plan_visibility: 'all',
  feature_visibility: DEFAULT_CLASSROOM_FEATURE_VISIBILITY, blueprint_source_revision: 0,
  source_blueprint_id: null, source_blueprint_origin: null, actual_site_slug: null,
  actual_site_published: false, actual_site_config: DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
  course_overview_markdown: '', course_outline_markdown: '', archived_at: null,
  created_at: '2026-08-01T12:00:00.000Z', updated_at: '2026-08-01T12:00:00.000Z',
}
const STUDENT_DOC: TiptapContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Compare two habitats and record one observation from each.' }] }] }
const STUDENT_LESSONS: LessonPlan[] = [
  { id: 'student-lp-1', classroom_id: STUDENT_CLASSROOM.id, date: '2026-09-14', content: STUDENT_DOC, content_markdown: 'Compare two habitats and record one observation from each.', created_at: STUDENT_CLASSROOM.created_at, updated_at: STUDENT_CLASSROOM.updated_at },
  { id: 'student-lp-2', classroom_id: STUDENT_CLASSROOM.id, date: '2026-09-16', content: STUDENT_DOC, content_markdown: 'Prepare an ecosystem food-web sketch.', created_at: STUDENT_CLASSROOM.created_at, updated_at: STUDENT_CLASSROOM.updated_at },
]
const STUDENT_CLASS_DAYS: ClassDay[] = Array.from({ length: 12 }, (_, index) => ({
  id: `student-day-${index}`, classroom_id: STUDENT_CLASSROOM.id,
  date: `2026-09-${String(index + 8).padStart(2, '0')}`, prompt_text: null, is_class_day: index % 7 < 5,
}))

export function StudentPageMockup({
  page,
  onPrototypeAction,
}: {
  page: StudentPageId
  onPrototypeAction: (action: string) => void
}) {
  if (page === 'today') return <StudentTodayMockup onPrototypeAction={onPrototypeAction} />
  if (page === 'classwork') return <StudentClassworkMockup onPrototypeAction={onPrototypeAction} />
  if (page === 'tests') return <StudentTestsMockup onPrototypeAction={onPrototypeAction} />
  if (page === 'calendar') return <StudentCalendarMockup />
  if (page === 'announcements') return <StudentAnnouncementsMockup />
  return <StudentResourcesMockup onPrototypeAction={onPrototypeAction} />
}

function StudentTodayMockup({ onPrototypeAction }: { onPrototypeAction: (action: string) => void }) {
  return (
    <div className="mx-auto max-w-3xl space-y-3" data-testid="student-today-mockup">
      <Card tone="panel" padding="lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-text-muted">Wednesday, September 16</p>
            <h4 className="mt-1 text-xl font-semibold">What&apos;s your plan for today?</h4>
          </div>
          <SaveStatus status="saved" />
        </div>
        <div className="mt-4 min-h-40 rounded-control border border-border bg-page p-4 text-sm leading-6 text-text-default">
          Compare the pond and meadow habitats, then sketch one food-chain relationship from each.
        </div>
      </Card>
      <Button type="button" variant="surface" fullWidth onClick={() => onPrototypeAction('View recent Daily logs')}>
        <span className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
          <span><span className="block font-semibold">Recent logs</span><span className="mt-0.5 block text-xs font-normal text-text-muted">Review previous Daily entries</span></span>
          <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
        </span>
      </Button>
      <p className="text-xs leading-5 text-text-muted">Today keeps the student&apos;s current Daily prompt and save state focused, with history available as a secondary action.</p>
    </div>
  )
}

function StudentClassworkMockup({ onPrototypeAction }: { onPrototypeAction: (action: string) => void }) {
  const items = [
    { title: 'Field observations', detail: 'Due Sep 18 · 2 days left', type: 'Assignment', status: 'In progress', tone: 'text-warning' },
    { title: 'Ecosystem reading', detail: 'Posted Sep 11', type: 'Material', status: 'Posted', tone: 'text-primary' },
    { title: 'Field trip check-in', detail: '3 questions', type: 'Survey', status: 'Update', tone: 'text-success' },
  ]
  return (
    <div className="space-y-3" data-testid="student-classwork-mockup">
      {items.map((item) => (
        <Button
          key={item.title}
          type="button"
          variant="surface"
          fullWidth
          className="h-auto justify-start rounded-card bg-surface-panel px-5 py-4 text-left transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-px hover:border-border-strong hover:bg-surface-accent hover:shadow-panel"
          onClick={() => onPrototypeAction(`Open ${item.title}`)}
        >
          <span className="flex items-start justify-between gap-4">
            <span className="min-w-0"><span className="block truncate text-base font-semibold">{item.title}</span><span className="mt-1 block text-sm text-text-muted">{item.detail}</span><span className="mt-1 block text-xs font-medium uppercase tracking-wide text-text-muted">{item.type}</span></span>
            <span className={`shrink-0 rounded-badge bg-surface-2 px-2.5 py-1 text-xs font-semibold ${item.tone}`}>{item.status}</span>
          </span>
        </Button>
      ))}
    </div>
  )
}

function StudentTestsMockup({ onPrototypeAction }: { onPrototypeAction: (action: string) => void }) {
  return (
    <div className="space-y-3" data-testid="student-tests-mockup">
      {STUDENT_TESTS.map((test) => <StudentTestListItem key={test.title} test={test} onClick={() => onPrototypeAction(`Open ${test.title}`)} />)}
    </div>
  )
}

function StudentCalendarMockup() {
  const [date, setDate] = useState(new Date('2026-09-14T12:00:00'))
  return (
    <div className="space-y-3" data-testid="student-calendar-mockup">
      <TeacherWorkSurfaceContextBar
        ariaLabel="Student calendar controls"
        primary={<DateNavigator joined label={`Week of ${format(date, 'MMM d')}`} onPrev={() => setDate((current) => subWeeks(current, 1))} onNext={() => setDate((current) => addWeeks(current, 1))} onLabelClick={() => setDate(new Date('2026-09-14T12:00:00'))} labelAriaLabel="Return to reference week" />}
      />
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <LessonCalendar classroom={STUDENT_CLASSROOM} lessonPlans={STUDENT_LESSONS} classDays={STUDENT_CLASS_DAYS} viewMode="week" currentDate={date} editable={false} showHeader={false} onDateChange={setDate} onViewModeChange={() => {}} />
      </div>
    </div>
  )
}

function StudentAnnouncementsMockup() {
  const announcements = [
    { title: 'Field study reminder', timestamp: 'Posted Aug 28', body: 'Bring a reusable water bottle and arrive by **8:20 AM**.' },
    { title: 'Lab groups', timestamp: 'Posted Aug 26', body: 'Your lab groups are ready. Check the classroom board before starting.' },
  ]
  return (
    <div className="mx-auto max-w-3xl space-y-3" data-testid="student-announcements-mockup">
      {announcements.map((announcement) => (
        <Card key={announcement.title} tone="panel" padding="md">
          <p className="text-xs text-text-muted">{announcement.timestamp}</p>
          <h4 className="mt-2 text-sm font-semibold">{announcement.title}</h4>
          <AnnouncementContent content={announcement.body} className="mt-2" />
        </Card>
      ))}
    </div>
  )
}

function StudentResourcesMockup({ onPrototypeAction }: { onPrototypeAction: (action: string) => void }) {
  const resources = [
    { title: 'Course guide', description: 'Overview, expectations and routines', icon: BookOpen },
    { title: 'Ecosystem field guide', description: 'Reference PDF', icon: FileText },
    { title: 'Species identification tool', description: 'External link', icon: LinkIcon },
  ]
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="student-resources-mockup">
      {resources.map(({ title, description, icon: Icon }) => (
        <Button key={title} type="button" variant="surface" fullWidth className="h-auto justify-start gap-3 p-4 text-left" onClick={() => onPrototypeAction(`Open ${title}`)}>
          <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0"><span className="block font-semibold">{title}</span><span className="mt-1 block text-xs font-normal text-text-muted">{description}</span></span>
        </Button>
      ))}
    </div>
  )
}
