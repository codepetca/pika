import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MobileDrawerControlsPattern } from '@/app/__ui/MobileDrawerControlsPattern'
import { TooltipProvider } from '@/ui'

describe('MobileDrawerControlsPattern actual owner composition', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each(['teacher', 'student'] as const)('retains the %s draft while switching actual drawers', async (role) => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390)
    render(<TooltipProvider><MobileDrawerControlsPattern role={role} /></TooltipProvider>)
    const draft = screen.getByRole('textbox', { name: 'Drawer example draft' })
    fireEvent.change(draft, { target: { value: 'Unsaved fixture draft' } })
    const navigation = screen.getByRole('button', { name: 'Open example navigation drawer' })
    navigation.focus()
    fireEvent.click(navigation)
    const drawer = screen.getByRole('dialog', { name: 'Navigation menu' })
    await waitFor(() => expect(within(drawer).getByRole('button', { name: 'Close navigation' })).toHaveFocus())
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close navigation' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(navigation).toHaveFocus()

    const details = screen.getByRole('button', { name: 'Open example detail drawer' })
    details.focus()
    fireEvent.click(details)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus())
    expect(screen.getByRole('dialog', { name: 'Drawer example details' })).toHaveTextContent(`Fixed ${role} detail content.`)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(details).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Drawer example draft' })).toBe(draft)
    expect(draft).toHaveValue('Unsaved fixture draft')
  })
})
