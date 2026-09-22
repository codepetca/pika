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
    await user.hover(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Hide grades from students')
    await user.click(button)
    expect(onChange).toHaveBeenCalledWith(false)
  })
})
