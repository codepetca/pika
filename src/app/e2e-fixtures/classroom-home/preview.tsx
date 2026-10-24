'use client'

import { AppShell } from '@/components/AppShell'
import { TeacherClassroomsIndex } from '@/app/classrooms/TeacherClassroomsIndex'
import type { Classroom } from '@/types'
import type { ClassroomHomePresentation } from '@/lib/contracts/classroom-home'

const owned = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'PPZ3C — Health for Life',
  theme_color: 'teal', term_label: 'Semester 1', class_code: 'HEALTH',
  start_date: '2026-09-01', end_date: '2027-01-29', updated_at: '2026-10-23T12:00:00Z',
} as Classroom
const joined: ClassroomHomePresentation['joined'][number] = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'ICS4U — Computer Science',
  theme_color: 'violet', term_label: 'Semester 1', class_code: 'CODE26',
  start_date: '2026-09-01', end_date: '2027-01-29', updated_at: '2026-10-23T12:00:00Z',
  relationship: 'member', enrollment_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', enrolled_at: '2026-09-01T12:00:00Z',
}

/** Real production composition with synthetic inputs. Not authentication/persistence evidence. */
export function ClassroomHomeFixture({ role, state, canCreate }: {
  role: 'teacher' | 'student'; state?: string; canCreate: boolean
}) {
  const home: ClassroomHomePresentation = {
    joined: state === 'hidden' || state === 'empty' ? [] : [joined],
    hidden: state === 'hidden' ? [joined] : [], canCreate, canImportBlueprint: role === 'teacher',
  }
  return <AppShell initialNow={Date.parse('2026-10-23T16:00:00Z')}
    user={{ id: '11111111-1111-4111-8111-111111111111', email: `${role}@example.invalid`, role }}
    pageTitle="Classrooms" mainClassName="flex-1 min-h-0 w-full max-w-7xl mx-auto px-4 py-3">
    <TeacherClassroomsIndex initialClassrooms={state === 'empty' ? [] : [owned]}
      initialReadError={state === 'error'} contextualHome={home} />
  </AppShell>
}
