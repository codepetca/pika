import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Tooltip, TooltipProvider } from '@/ui'

describe('Tooltip click help', () => {
  it('opens on click, describes its button, and dismisses with another click', async () => {
    render(<TooltipProvider><Tooltip content="Format advice" openOnClick><button>Help</button></Tooltip></TooltipProvider>)
    const button = screen.getByRole('button', { name: 'Help' })
    fireEvent.click(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Format advice')
    expect(button).toHaveAccessibleDescription('Format advice')
    fireEvent.click(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
