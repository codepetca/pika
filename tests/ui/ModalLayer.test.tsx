import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModalLayer } from '@/ui'

describe('ModalLayer', () => {
  it('isolates the page, contains focus, and restores the opener on close', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [isOpen, setIsOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setIsOpen(true)}>Open dialog</button>
          <ModalLayer isOpen={isOpen} onClose={() => setIsOpen(false)} ariaLabel="Focus contract">
            <button type="button" data-modal-initial-focus>First action</button>
            <button type="button" onClick={() => setIsOpen(false)}>Done</button>
          </ModalLayer>
        </>
      )
    }

    const { container } = render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open dialog' })
    await user.click(opener)

    const firstAction = await screen.findByRole('button', { name: 'First action' })
    const done = screen.getByRole('button', { name: 'Done' })
    await waitFor(() => expect(firstAction).toHaveFocus())
    expect(container).toHaveAttribute('aria-hidden', 'true')
    expect(container.inert).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')

    await user.tab({ shift: true })
    expect(done).toHaveFocus()
    await user.tab()
    expect(firstAction).toHaveFocus()

    await user.click(done)
    await waitFor(() => expect(opener).toHaveFocus())
    expect(container).not.toHaveAttribute('aria-hidden')
    expect(container.inert).toBe(false)
    expect(document.body.style.overflow).toBe('')
  })

  it('only lets the top nested layer handle Escape', () => {
    const closeOuter = vi.fn()
    const closeInner = vi.fn()

    render(
      <>
        <ModalLayer isOpen onClose={closeOuter} ariaLabel="Outer dialog">
          Outer content
        </ModalLayer>
        <ModalLayer isOpen onClose={closeInner} ariaLabel="Inner dialog">
          Inner content
        </ModalLayer>
      </>
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeInner).toHaveBeenCalledOnce()
    expect(closeOuter).not.toHaveBeenCalled()
  })

  it('wraps reverse Tab from a panel-focused custom dialog', async () => {
    render(
      <ModalLayer isOpen onClose={vi.fn()} ariaLabel="Custom dialog">
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </ModalLayer>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Custom dialog' })
    await waitFor(() => expect(dialog).toHaveFocus())
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Last action' })).toHaveFocus()
  })
})
