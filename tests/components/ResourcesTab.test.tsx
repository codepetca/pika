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
  source_blueprint_id: null,
  source_blueprint_origin: null,
  actual_site_slug: 'test-classroom',
  actual_site_published: true,
  actual_site_config: {
    overview: true,
    outline: true,
    resources: true,
    assignments: true,
    quizzes: true,
    tests: true,
    lesson_plans: true,
    announcements: true,
    lesson_plan_scope: 'current_week',
  },
  course_overview_markdown: '',
  course_outline_markdown: '',
} as const

describe('ResourcesTab', () => {
  it('renders teacher resources as a syllabus entry point', () => {
    render(<TeacherResourcesTab classroom={classroom} />)

    expect(screen.getByTitle('Test Classroom syllabus preview')).toHaveAttribute('src', '/actual/test-classroom')
    expect(screen.queryByText('Public syllabus')).toBeNull()
    expect(screen.queryByRole('button', { name: /open external/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /syllabus settings/i })).toBeNull()
    expect(screen.queryByRole('link', { name: '/actual/test-classroom' })).toBeNull()
    expect(screen.queryByText('Teacher announcements content')).toBeNull()
  })

  it('renders student resources as a syllabus entry point', () => {
    render(<StudentResourcesTab classroom={classroom} />)

    expect(screen.getByTitle('Test Classroom syllabus preview')).toHaveAttribute('src', '/actual/test-classroom')
    expect(screen.queryByText('Public syllabus')).toBeNull()
    expect(screen.queryByRole('button', { name: /open external/i })).toBeNull()
    expect(screen.queryByText('Student announcements content')).toBeNull()
  })

  it('shows unpublished state for students when the site is private', () => {
    render(<StudentResourcesTab classroom={{ ...classroom, actual_site_published: false }} />)

    expect(screen.getByText('No syllabus yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /open external/i })).toBeNull()
    expect(screen.queryByTitle('Test Classroom syllabus preview')).toBeNull()
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
