'use client'

import { useState } from 'react'
import { LessonDayCell } from '@/components/LessonDayCell'
import { ClassworkTypeIcon, type ClassworkType } from '@/components/ClassworkTypeIcon'
import { Button, Card, SegmentedControl } from '@/ui'
import type { Announcement, Assignment, ClassworkMaterial } from '@/types'
import { CALENDAR_REFERENCE_TEST } from './calendar-test-fixtures'

const stamp = '2026-09-01T12:00:00Z'
const assignment: Assignment = {
  id: 'identity-assignment', classroom_id: 'calendar-reference', title: 'Field observations',
  description: '', instructions_markdown: '', rich_instructions: null, due_at: '2026-09-15T20:00:00Z',
  position: 0, is_draft: false, released_at: stamp, track_authenticity: false,
  created_by: 'reference-teacher', created_at: stamp, updated_at: stamp,
}
const material: ClassworkMaterial = {
  id: 'identity-material', classroom_id: 'calendar-reference', title: 'Ecosystem reading',
  content: { type: 'doc', content: [] }, position: 0, is_draft: false, released_at: stamp,
  created_by: 'reference-teacher', created_at: stamp, updated_at: stamp,
}
const announcement: Announcement = {
  id: 'identity-announcement', classroom_id: 'calendar-reference', title: 'Bring headphones',
  content: 'Bring headphones for the field recordings.', is_draft: false,
  published_at: stamp, scheduled_for: null, created_by: 'reference-teacher', created_at: stamp, updated_at: stamp,
}
const identities: { type: ClassworkType; title: string; label: string }[] = [
  { type: 'assignment', title: 'Field observations', label: 'Assignment' },
  { type: 'material', title: 'Ecosystem reading', label: 'Material' },
  { type: 'survey', title: 'Field trip check-in', label: 'Survey' },
]

export function CalendarIdentityPattern() {
  const [layout, setLayout] = useState<'agenda' | 'grid'>('agenda')
  const [selected, setSelected] = useState('Example only—nothing is saved.')
  return <section id="calendar-identity" data-testid="calendar-identity-pattern" className="space-y-4">
    <h3 className="font-semibold">Calendar themes and Classwork identity</h3>
    <p className="text-sm text-text-muted">Due dates and tests share amber. Materials use quiet slate; surveys use light green. Announcements use soft peach-orange. Icons identify content type, independently of status.</p>
    <SegmentedControl ariaLabel="Identity calendar layout" value={layout} onChange={setLayout}
      options={[{ value: 'agenda', label: 'Week' }, { value: 'grid', label: 'Grid' }]} />
    <Card tone="panel" padding="none" className={layout === 'grid' ? 'max-w-sm' : undefined}>
      <LessonDayCell date="2026-09-15" day={new Date('2026-09-15T12:00:00')} lessonPlan={null}
        tests={[CALENDAR_REFERENCE_TEST]} assignments={[assignment]} materials={[material]} announcements={[announcement]}
        isWeekend={false} isToday={false} editable={false} layout={layout}
        onTestClick={() => setSelected('Open test')} onAssignmentClick={() => setSelected('Open assignment')}
        onMaterialClick={() => setSelected('Open material')} onAnnouncementClick={() => setSelected('Open announcement')} />
    </Card>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" className="bg-calendar-survey-bg text-calendar-survey hover:bg-calendar-survey-hover"
        onClick={() => setSelected('Open survey')}><ClassworkTypeIcon type="survey" />Survey: Field trip check-in</Button>
      <span className="text-xs text-text-muted">Survey identity preview; calendar scheduling is unchanged.</span>
    </div>
    <div className="space-y-2" aria-label="Classwork type identities">
      {identities.map(({ type, title, label }) => <div key={type} className="flex items-center gap-2 text-sm">
        <ClassworkTypeIcon type={type} /><span className="min-w-0 truncate">{title}</span><span className="text-xs text-text-muted">{label}</span>
      </div>)}
    </div>
    <p role="status" className="text-xs text-text-muted">{selected}</p>
  </section>
}
