'use client'

import { useState } from 'react'
import { Card } from '@/ui'
import { NavItems, ThreePanelProvider } from '@/components/layout'
import { LessonDayCell } from '@/components/LessonDayCell'
import type { Announcement } from '@/types'

const plain: Announcement = {
  id: 'tooltip-plain', classroom_id: 'pattern-lab', title: 'Plain calendar reminder',
  content: 'Bring your notes to class.', created_by: 'pattern-teacher', is_draft: false,
  published_at: '2026-10-21T12:00:00Z', scheduled_for: null,
  created_at: '2026-10-21T12:00:00Z', updated_at: '2026-10-21T12:00:00Z',
}
const formatted: Announcement = {
  ...plain, id: 'tooltip-formatted', title: 'Formatted calendar reminder',
  content: '# Class reminder\n\n## Before class\n\n### Your notes\n\n> Bring your notes to class.\n\nRead the [class guide](https://example.invalid/guide).',
}

/** Actual owners and fixed data, outside the stable catalog snapshot boundary. */
export function TooltipAdoptionPattern({ role }: { role: 'teacher' | 'student' }) {
  const [lastAction, setLastAction] = useState('No example action selected')
  return <section id="tooltip-adopters" aria-label="Tooltip adopter consistency" className="space-y-4">
    <Card tone="panel" padding="md">
      <h2 className="font-semibold">Tooltip adopter consistency</h2>
      <div className="mt-4 flex items-start gap-4">
        <div className="w-16 shrink-0" role="region" aria-label="Collapsed classroom navigation">
          <ThreePanelProvider routeKey="calendar-teacher" initialLeftExpanded={false} persistLeftSidebar={false}>
            <NavItems expanded={false} classroomId="pattern-lab" role={role} activeTab="calendar"
              onTabChange={tab => setLastAction(`Navigation: ${tab}`)} updateSearchParams={() => {}} />
          </ThreePanelProvider>
        </div>
        <div className="min-w-0 flex-1">
          <LessonDayCell date="2026-10-21" day={new Date('2026-10-21T12:00:00Z')} lessonPlan={null}
            isWeekend={false} isToday={false} isClassDay editable={false} layout="agenda"
            announcements={[plain, formatted]} onAnnouncementClick={() => setLastAction('Announcement opened')} />
        </div>
      </div>
      <p role="status" className="mt-4 text-sm text-text-muted">{lastAction}</p>
    </Card>
  </section>
}
