import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TeacherEditModeControls } from '@/components/teacher-work-surface/TeacherEditModeControls'
import { TooltipProvider } from '@/ui'

function renderControls({
  active,
  onActiveChange = vi.fn(),
  disabled = false,
}: {
  active: boolean
  onActiveChange?: (active: boolean) => void
  disabled?: boolean
}) {
  return {
    onActiveChange,
    ...render(
      <TooltipProvider>
        <TeacherEditModeControls
          active={active}
          onActiveChange={onActiveChange}
          disabled={disabled}
        >
          <button type="button">Code</button>
        </TeacherEditModeControls>
      </TooltipProvider>,
    ),
  }
}

describe('TeacherEditModeControls', () => {
  it('renders inactive state without edit-only children', () => {
    renderControls({ active: false })

    const toggle = screen.getByRole('button', { name: 'Edit' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveTextContent('')
    expect(screen.queryByRole('button', { name: 'Code' })).not.toBeInTheDocument()
  })

  it('renders active state with edit-only children', () => {
    renderControls({ active: true })

    const toggle = screen.getByRole('button', { name: 'Edit' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Code' })).toBeInTheDocument()
  })

  it('toggles active state requests and supports disabled state', () => {
    const { onActiveChange, rerender } = renderControls({ active: false })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onActiveChange).toHaveBeenCalledWith(true)

    rerender(
      <TooltipProvider>
        <TeacherEditModeControls
          active
          onActiveChange={onActiveChange}
          disabled
        >
          <button type="button">Code</button>
        </TeacherEditModeControls>
      </TooltipProvider>,
    )

    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
  })
})
