import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TeacherGradebookVisibilityControl } from '@/components/gradebook/TeacherGradebookVisibilityControl'
import { TooltipProvider } from '@/ui'

function renderControl(gradesVisible: boolean, onChange = vi.fn()) {
  render(
    <TooltipProvider>
      <TeacherGradebookVisibilityControl gradesVisible={gradesVisible} onChange={onChange} />
    </TooltipProvider>,
  )
  return { onChange }
}

describe('TeacherGradebookVisibilityControl', () => {
  it('offers to show hidden grades and exposes the unpressed state', async () => {
    const user = userEvent.setup()
    const { onChange } = renderControl(false)
    const button = screen.getByRole('switch', { name: 'Student grades visibility' })

    expect(button).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('teacher-gradebook-visibility-control').querySelector('.lucide-users')).toBeNull()
    expect(button).toHaveClass('w-16')
    expect(button.firstElementChild?.firstElementChild).toHaveClass('bg-text-muted')
    await user.hover(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Show grades to students')
    await user.click(button)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('offers to hide visible grades and exposes the pressed state', async () => {
    const user = userEvent.setup()
    const { onChange } = renderControl(true)
    const button = screen.getByRole('switch', { name: 'Student grades visibility' })

    expect(button).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('teacher-gradebook-visibility-control').querySelector('.lucide-users')).toBeTruthy()
    expect(button.firstElementChild).toHaveClass('bg-success-solid')
    expect(button.querySelector('.lucide-users')?.parentElement).toHaveClass('h-6', 'w-6', 'translate-x-9')
    await user.hover(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Hide grades from students')
    await user.click(button)
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('keeps the visible treatment while an optimistic save is in flight', () => {
    render(
      <TooltipProvider>
        <TeacherGradebookVisibilityControl gradesVisible onChange={vi.fn()} saving />
      </TooltipProvider>,
    )

    const button = screen.getByRole('switch', { name: 'Student grades visibility' })
    expect(button).toHaveAttribute('aria-checked', 'true')
    expect(button).toBeDisabled()
    expect(button.firstElementChild).toHaveClass('bg-success-solid')
    expect(button.querySelector('.lucide-users')).toBeTruthy()
    expect(screen.getByTestId('teacher-gradebook-visibility-control')).toHaveAttribute('aria-busy', 'true')
  })
})
