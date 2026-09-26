import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TableSelectionCheckbox, TooltipProvider } from '@/ui'

describe('TableSelectionCheckbox', () => {
  it('explains a disabled selection on hover and keyboard focus, then permits selection when enabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const renderCheckbox = (disabled: boolean) => (
      <TooltipProvider>
        <TableSelectionCheckbox
          checked={false}
          onChange={onChange}
          ariaLabel="Select Alice"
          disabled={disabled}
          disabledTooltip="Publish the test first to select students."
        />
      </TooltipProvider>
    )
    const { rerender } = render(renderCheckbox(true))
    const checkbox = screen.getByRole('checkbox', { name: 'Select Alice' })
    expect(checkbox).toBeDisabled()
    const help = screen.getByRole('note', { name: 'Publish the test first to select students.' })
    await user.hover(help)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Publish the test first to select students.')
    await user.tab()
    expect(help).toHaveFocus()

    rerender(renderCheckbox(false))
    expect(screen.queryByRole('note', { name: 'Publish the test first to select students.' })).not.toBeInTheDocument()
    const enabledCheckbox = screen.getByRole('checkbox', { name: 'Select Alice' })
    expect(enabledCheckbox).toBeEnabled()
    await user.click(enabledCheckbox)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
