import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { StudentClassroomsIndex } from '@/app/classrooms/StudentClassroomsIndex'
import { createMockClassroom } from '../helpers/mocks'

const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

describe('StudentClassroomsIndex', () => {
  beforeEach(() => {
    push.mockReset()
  })

  it('shows immediate feedback while opening a classroom', () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101' })]
    render(<StudentClassroomsIndex initialClassrooms={classrooms} />)

    const openButton = screen.getByRole('button', { name: /^Math 101/ })
    fireEvent.click(openButton)

    expect(push).toHaveBeenCalledWith('/classrooms/c1?tab=today')
    expect(openButton).toBeDisabled()
    expect(screen.getByText('Opening classroom...')).toBeInTheDocument()
  })

  it('themes the classroom card background without an accent border', () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101', theme_color: 'rose' })]
    render(<StudentClassroomsIndex initialClassrooms={classrooms} />)

    const openButton = screen.getByRole('button', { name: /^Math 101/ })

    expect(openButton).toHaveAttribute('data-classroom-theme-color', 'rose')
    expect(openButton).toHaveClass('classroom-theme-card')
    expect(openButton).toHaveClass('classroom-theme-card-interactive')
    expect(openButton).toHaveClass('border')
    expect(openButton).not.toHaveClass('border-l-4')
  })
})
