import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ClassroomDropdown } from '@/components/ClassroomDropdown'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push,
  }),
}))

describe('ClassroomDropdown', () => {
  const classrooms = [
    { id: 'class-1', title: 'Alpha', code: 'AAA111' },
    { id: 'class-2', title: 'Beta', code: 'BBB222' },
    { id: 'class-3', title: 'Gamma', code: 'CCC333' },
  ]

  beforeEach(() => {
    push.mockReset()
  })

  it('opens on click and does not auto-open on hover', () => {
    render(
      <ClassroomDropdown
        classrooms={classrooms}
        currentClassroomId="class-2"
        currentTab="attendance"
      />
    )

    const trigger = screen.getByRole('button', { name: 'Select classroom' })
    fireEvent.mouseEnter(trigger)

    expect(screen.getByRole('listbox')).toHaveClass('pointer-events-none')

    fireEvent.click(trigger)

    expect(screen.getByRole('option', { name: /Alpha/ })).toBeVisible()
    expect(screen.getByRole('option', { name: /Beta/ })).toBeVisible()
    expect(screen.getByRole('option', { name: /Gamma/ })).toBeVisible()
  })

  it('preserves classroom order and marks the current classroom', () => {
    render(
      <ClassroomDropdown
        classrooms={classrooms}
        currentClassroomId="class-2"
        currentTab="attendance"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Select classroom' }))

    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent?.trim())).toEqual(['Alpha', 'BetaCurrent', 'Gamma'])
    expect(options[1]).toHaveAttribute('aria-current', 'page')
    expect(options[1]).toBeDisabled()
    expect(screen.getByText('Current')).toBeInTheDocument()
  })

  it('navigates to the selected classroom tab', () => {
    render(
      <ClassroomDropdown
        classrooms={classrooms}
        currentClassroomId="class-2"
        currentTab="attendance"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Select classroom' }))
    fireEvent.click(screen.getByRole('option', { name: /Gamma/ }))

    expect(push).toHaveBeenCalledWith('/classrooms/class-3?tab=attendance')
  })

  it('skips the current classroom during keyboard navigation', () => {
    render(
      <ClassroomDropdown
        classrooms={classrooms}
        currentClassroomId="class-2"
        currentTab="attendance"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Select classroom' }))

    const alpha = screen.getByRole('option', { name: /Alpha/ })
    const gamma = screen.getByRole('option', { name: /Gamma/ })

    expect(alpha).toHaveFocus()

    fireEvent.keyDown(alpha, { key: 'ArrowDown' })

    expect(gamma).toHaveFocus()

    fireEvent.keyDown(gamma, { key: 'Enter' })

    expect(push).toHaveBeenCalledWith('/classrooms/class-3?tab=attendance')
  })
})
