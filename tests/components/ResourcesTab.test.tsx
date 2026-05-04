import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TeacherResourcesTab } from '@/app/classrooms/[classroomId]/TeacherResourcesTab'
import { StudentResourcesTab } from '@/app/classrooms/[classroomId]/StudentResourcesTab'
import { TeacherAnnouncementsTab } from '@/app/classrooms/[classroomId]/TeacherAnnouncementsTab'
import { StudentAnnouncementsTab } from '@/app/classrooms/[classroomId]/StudentAnnouncementsTab'

vi.mock('@/app/classrooms/[classroomId]/TeacherClassResourcesSidebar', () => ({
  TeacherClassResourcesSidebar: () => <div>Teacher resources content</div>,
}))

vi.mock('@/app/classrooms/[classroomId]/StudentClassResourcesSidebar', () => ({
  StudentClassResourcesSidebar: () => <div>Student resources content</div>,
}))

vi.mock('@/app/classrooms/[classroomId]/TeacherAnnouncementsSection', () => ({
  TeacherAnnouncementsSection: () => <div>Teacher announcements content</div>,
}))

vi.mock('@/app/classrooms/[classroomId]/StudentAnnouncementsSection', () => ({
  StudentAnnouncementsSection: () => <div>Student announcements content</div>,
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
  it('renders teacher resources without announcements content', () => {
    render(<TeacherResourcesTab classroom={classroom} />)

    expect(screen.getByText('Teacher resources content')).toBeInTheDocument()
    expect(screen.queryByText('Teacher announcements content')).toBeNull()
  })

  it('renders student resources without announcements content', () => {
    render(<StudentResourcesTab classroom={classroom} />)

    expect(screen.getByText('Student resources content')).toBeInTheDocument()
    expect(screen.queryByText('Student announcements content')).toBeNull()
  })

  it('renders teacher announcements in the announcements tab', () => {
    render(<TeacherAnnouncementsTab classroom={classroom} />)

    expect(screen.getByText('Teacher announcements content')).toBeInTheDocument()
    expect(screen.queryByText('Teacher resources content')).toBeNull()
  })

  it('renders student announcements in the announcements tab', () => {
    render(<StudentAnnouncementsTab classroom={classroom} />)

    expect(screen.getByText('Student announcements content')).toBeInTheDocument()
    expect(screen.queryByText('Student resources content')).toBeNull()
  })
})
