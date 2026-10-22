import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateBlueprintModal } from '@/components/CreateBlueprintModal'

describe('CreateBlueprintModal close control', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('closes from the shared corner control', () => {
    const onClose = vi.fn()
    render(<CreateBlueprintModal isOpen onClose={onClose} onSuccess={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Create Course Blueprint' })
    const close = within(dialog).getByRole('button', { name: 'Close', exact: true })
    expect(close.closest('[data-dialog-close]')).toHaveClass('right-3', 'top-3')
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('blocks corner, Escape and backdrop dismissal while creation is pending', async () => {
    let rejectCreation: (reason: Error) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((_resolve, reject) => { rejectCreation = reject })))
    const onClose = vi.fn()
    render(<CreateBlueprintModal isOpen onClose={onClose} onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: /Blueprint Title/ }), { target: { value: 'Science' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create', exact: true }))
    const close = screen.getByRole('button', { name: 'Close', exact: true })
    expect(close).toBeDisabled()
    fireEvent.click(close)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => rejectCreation(new Error('Try again')))
    expect(close).toBeEnabled()
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
