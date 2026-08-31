import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Plus } from 'lucide-react'
import { IconButton, TooltipProvider } from '@/ui'

describe('IconButton', () => {
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
})
