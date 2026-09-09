import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Plus } from 'lucide-react'
import { IconButton, TooltipProvider } from '@/ui'

describe('IconButton', () => {
  it('exposes formatted help on keyboard focus while retaining its accessible name', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <IconButton icon={Plus} label="Roster format help" tooltipOnClick tooltip={<div>Format: <strong>First Last Email</strong><p>ID is optional</p></div>} />
      </TooltipProvider>,
    )
    await user.tab()
    expect(screen.getByRole('button', { name: 'Roster format help' })).toHaveFocus()
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('Format: First Last Email')
    expect(tooltip).toHaveTextContent('ID is optional')
    expect(tooltip.querySelector('strong')).toHaveTextContent('First Last Email')
    expect(screen.getByRole('button', { name: 'Roster format help' })).toHaveAccessibleDescription(/Format: First Last Email/)
  })

  it('toggles help on activation and dismisses with Escape', async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><IconButton icon={Plus} label="Help" tooltipOnClick tooltip="Helpful instructions" /></TooltipProvider>)
    const button = screen.getByRole('button', { name: 'Help' })
    fireEvent.click(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Helpful instructions')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('names the icon, explains it on keyboard focus, and activates with Enter', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<TooltipProvider><IconButton icon={Plus} label="Create assignment" onClick={onClick} /></TooltipProvider>)
    const button = screen.getByRole('button', { name: 'Create assignment' })
    expect(button.textContent).toBe('')
    await user.tab()
    expect(button).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Create assignment')
    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('prevents repeat creation while busy and retains its accessible name', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { rerender } = render(<TooltipProvider><IconButton icon={Plus} label="Create test" onClick={onClick} loading /></TooltipProvider>)
    const button = screen.getByRole('button', { name: 'Create test' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
    rerender(<TooltipProvider><IconButton icon={Plus} label="Create test" onClick={onClick} /></TooltipProvider>)
    expect(button).not.toHaveAttribute('aria-busy')
    await user.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('can keep a specific accessible name with a shorter visible tooltip', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <IconButton icon={Plus} label="Undo manual change for Noah Williams" tooltip="Undo manual change" />
      </TooltipProvider>,
    )

    const button = screen.getByRole('button', { name: 'Undo manual change for Noah Williams' })
    await user.hover(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Undo manual change$/)
  })
})
