import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TeacherResourcesTab } from '@/app/classrooms/[classroomId]/TeacherResourcesTab'
import { StudentResourcesTab } from '@/app/classrooms/[classroomId]/StudentResourcesTab'

vi.mock('@/app/classrooms/[classroomId]/TeacherAnnouncementsSection', () => ({
  TeacherAnnouncementsSection: () => <div>Teacher announcements content</div>,
}))

vi.mock('@/app/classrooms/[classroomId]/StudentAnnouncementsSection', () => ({
  StudentAnnouncementsSection: () => <div>Student announcements content</div>,
}))

vi.mock('@/components/layout', () => ({
  RightSidebarToggle: () => <button type="button">Open panel</button>,
}))

const classroom = {
  id: 'classroom-1',
  teacher_id: 'teacher-1',
  title: 'Test Classroom',
  class_code: 'ABC123',
  term_label: null,
  created_at: '2026-04-14T00:00:00.000Z',
  updated_at: '2026-04-14T00:00:00.000Z',
  allow_enrollment: true,
  start_date: '2026-02-01',
  end_date: '2026-06-30',
  archived_at: null,
  lesson_plan_visibility: 'current_week',
  position: 0,
} as const

describe('ResourcesTab', () => {
  it('renders teacher resources as announcements plus a panel toggle', () => {
    render(<TeacherResourcesTab classroom={classroom} />)

    expect(screen.getByText('Teacher announcements content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open panel' })).toBeInTheDocument()
    expect(screen.queryByText('Announcements')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Class Resources' })).toBeNull()
  })

  it('renders student resources as announcements plus a panel toggle', () => {
    render(<StudentResourcesTab classroom={classroom} />)

    expect(screen.getByText('Student announcements content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open panel' })).toBeInTheDocument()
    expect(screen.queryByText('Announcements')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Class Resources' })).toBeNull()
  })
})
