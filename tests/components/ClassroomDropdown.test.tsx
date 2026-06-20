import { fireEvent, render, screen, within } from '@testing-library/react'
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
    { id: 'class-1', title: 'Alpha', code: 'AAA111', themeColor: 'teal' as const },
    { id: 'class-2', title: 'Beta', code: 'BBB222', themeColor: 'rose' as const },
    { id: 'class-3', title: 'Gamma', code: 'CCC333', themeColor: 'cyan' as const },
  ]

  beforeEach(() => {
    push.mockReset()
  })

  function pointerClick(element: HTMLElement) {
    fireEvent.pointerDown(element, { pointerType: 'mouse' })
    fireEvent.click(element)
  }

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

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(document.getElementById(trigger.getAttribute('aria-controls') ?? '')).toHaveAttribute('aria-hidden', 'true')

    pointerClick(trigger)

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

    pointerClick(screen.getByRole('button', { name: 'Select classroom' }))

    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent?.trim())).toEqual(['Alpha', 'BetaCurrent', 'Gamma'])
    expect(options[1]).toHaveAttribute('aria-current', 'page')
    expect(options[1]).toBeDisabled()
    expect(screen.getByText('Current')).toBeInTheDocument()
  })

  it('renders classroom names without marker elements', () => {
    render(
      <ClassroomDropdown
        classrooms={classrooms}
        currentClassroomId="class-2"
        currentTab="attendance"
      />
    )

    const trigger = screen.getByRole('button', { name: 'Select classroom' })
    expect(trigger).toHaveTextContent('Beta')
    expect(trigger.querySelector('[data-classroom-theme-color]')).toBeNull()

    pointerClick(trigger)

    expect(screen.getByRole('option', { name: /Alpha/ })).toHaveTextContent('Alpha')
    expect(screen.getByRole('option', { name: /Gamma/ })).toHaveTextContent('Gamma')
    expect(screen.getByRole('listbox').querySelector('[data-classroom-theme-color]')).toBeNull()
  })

  it('navigates to the selected classroom tab', () => {
    render(
      <ClassroomDropdown
        classrooms={classrooms}
        currentClassroomId="class-2"
        currentTab="attendance"
      />
    )

    pointerClick(screen.getByRole('button', { name: 'Select classroom' }))
    pointerClick(screen.getByRole('option', { name: /Gamma/ }))

    expect(push).toHaveBeenCalledWith('/classrooms/class-3?tab=attendance')
  })

  it('shows immediate feedback after selecting a classroom', () => {
    render(
      <ClassroomDropdown
        classrooms={classrooms}
        currentClassroomId="class-2"
        currentTab="attendance"
      />
    )

    pointerClick(screen.getByRole('button', { name: 'Select classroom' }))
    pointerClick(screen.getByRole('option', { name: /Gamma/ }))

    const trigger = screen.getByRole('button', { name: 'Select classroom' })
    expect(within(trigger).getByText('Opening Gamma...')).toBeInTheDocument()
    expect(trigger).toBeDisabled()
  })

  it('skips the current classroom during keyboard navigation', () => {
    render(
      <ClassroomDropdown
        classrooms={classrooms}
        currentClassroomId="class-2"
        currentTab="attendance"
      />
    )

    pointerClick(screen.getByRole('button', { name: 'Select classroom' }))

    const alpha = screen.getByRole('option', { name: /Alpha/ })
    const gamma = screen.getByRole('option', { name: /Gamma/ })

    expect(alpha).toHaveFocus()

    fireEvent.keyDown(alpha, { key: 'ArrowDown' })

    expect(gamma).toHaveFocus()

    fireEvent.keyDown(gamma, { key: 'Enter' })

    expect(push).toHaveBeenCalledWith('/classrooms/class-3?tab=attendance')
  })

  it('closes with Escape and outside click while restoring focus to the trigger', () => {
    render(
      <ClassroomDropdown
        classrooms={classrooms}
        currentClassroomId="class-2"
        currentTab="attendance"
      />
    )

    const trigger = screen.getByRole('button', { name: 'Select classroom' })
    pointerClick(trigger)
    const alpha = screen.getByRole('option', { name: /Alpha/ })
    expect(alpha).toHaveFocus()

    fireEvent.keyDown(alpha, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    pointerClick(trigger)
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('does not steal focus on outside clicks while closed', () => {
    render(
      <>
        <button type="button">Outside target</button>
        <ClassroomDropdown
          classrooms={classrooms}
          currentClassroomId="class-2"
          currentTab="attendance"
        />
      </>
    )

    const outsideTarget = screen.getByRole('button', { name: 'Outside target' })
    outsideTarget.focus()

    fireEvent.mouseDown(document.body)

    expect(outsideTarget).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Select classroom' })).not.toHaveFocus()
  })
})
