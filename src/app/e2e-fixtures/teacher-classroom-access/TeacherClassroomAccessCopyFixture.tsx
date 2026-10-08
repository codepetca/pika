'use client'

import { useState } from 'react'
import { Button } from '@/ui'
import type { Classroom } from '@/types'
import { TeacherSettingsTab } from '@/app/classrooms/[classroomId]/TeacherSettingsTab'

// Development opt-in fixture: the application owner persists across replacement
// and retirement of the real Settings owner; no server mutations are performed.
export function TeacherClassroomAccessCopyFixture({ classroom }: { classroom: Classroom }) {
  const [current, setCurrent] = useState(classroom)
  const [visible, setVisible] = useState(true)
  return <>
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setCurrent({ ...current, updated_at: '2026-10-07T00:00:00Z' })}>Refresh copy owner</Button>
      <Button onClick={() => setCurrent({ ...classroom, id: `${classroom.id}-replacement`, title: 'Chemistry 12', class_code: 'CHEM12' })}>Replace copy owner</Button>
      <Button onClick={() => setVisible(false)}>Retire copy owner</Button>
    </div>
    {visible && <TeacherSettingsTab classroom={current} sectionParam="access" />}
  </>
}
