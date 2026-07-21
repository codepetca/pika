import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('uses the governed page heading and keyboard-ready mobile actions menu', async () => {
    render(<StudentClassroomsIndex initialClassrooms={[]} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Classrooms' })).toHaveClass(
      'text-2xl',
      'font-semibold',
    )

    const menuButton = screen.getByRole('button', { name: 'Open actions menu' })
    fireEvent.click(menuButton)

    const joinItem = within(screen.getByRole('menu')).getByRole('menuitem', {
      name: '+ Join classroom',
    })
    await waitFor(() => expect(joinItem).toHaveFocus())
    expect(joinItem).toHaveClass('min-h-11', 'focus-visible:ring-2')
  })
})
