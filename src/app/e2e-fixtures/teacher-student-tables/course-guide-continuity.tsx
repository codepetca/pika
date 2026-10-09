'use client'

import { useState } from 'react'
import { ClassroomPageClient } from '@/app/classrooms/[classroomId]/ClassroomPageClient'
import { Button } from '@/ui'
import type { Classroom } from '@/types'

/** Controlled props for real production owners; reachable only through the gated dev fixture. */
export function CourseGuideContinuityFixture({ classroom, initialRole, query }: {
  classroom: Classroom
  initialRole: 'teacher' | 'student'
  query: Record<string, string | undefined>
}) {
  const [current, setCurrent] = useState(classroom)
  const [role, setRole] = useState(initialRole)
  return (
    <>
      <div role="group" aria-label="Course guide fixture controls" className="flex flex-wrap gap-2 bg-surface px-2 py-1">
        <Button variant="secondary" onClick={() => setCurrent((value) => ({
          ...value,
          updated_at: new Date(Date.parse(value.updated_at) + 1000).toISOString(),
        }))}>Refresh guide fixture</Button>
        <Button variant="secondary" onClick={() => setCurrent((value) => ({
          ...value,
          id: '30000000-0000-4000-8000-000000000016',
          title: 'Different guide fixture',
        }))}>Change guide classroom</Button>
        <Button variant="secondary" onClick={() => setRole((value) => value === 'teacher' ? 'student' : 'teacher')}>
          Change guide role
        </Button>
      </div>
      <ClassroomPageClient
        initialNow={Date.parse('2026-10-05T16:00:00Z')}
        classroom={current}
        user={{ id: role === 'teacher' ? current.teacher_id : '30000000-0000-4000-8000-000000000015',
          email: `${role}@example.invalid`, role, first_name: 'Fixture', last_name: role }}
        classroomRole={role}
        teacherClassrooms={role === 'teacher' ? [current] : []}
        initialSearchParams={query}
        attendanceAvailable
        classroomQrAvailable
      />
    </>
  )
}
