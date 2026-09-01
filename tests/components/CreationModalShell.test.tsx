import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CreationModalShell, CreationModalTopRow } from '@/components/creation/CreationModalShell'

describe('CreationModalShell', () => {
  it('can visually hide and collapse a top-row label without removing its semantics', () => {
    render(
      <CreationModalTopRow
        title="Field observations"
        titlePlaceholder="Title"
        hideTitleLabel
        titleStatus={<span role="status">Saved</span>}
        onTitleChange={vi.fn()}
      />,
    )

    const title = screen.getByRole('textbox', { name: 'Title' })
    expect(document.querySelector(`label[for="${title.id}"]`)).toHaveClass('sr-only')
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('labels the dialog and exposes its close control', () => {
    const onClose = vi.fn()

    render(
      <CreationModalShell
        isOpen
        title="Create assignment"
        titleId="create-assignment-title"
        closeLabel="Close assignment editor"
        onClose={onClose}
      >
        <p>Assignment fields</p>
      </CreationModalShell>,
    )

    expect(screen.getByRole('dialog', { name: 'Create assignment' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).not.toHaveClass('h-[90dvh]')
    expect(screen.getByText('Assignment fields')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close assignment editor' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps the tall layout footer outside scrolling content and restores keyboard focus', async () => {
    const user = userEvent.setup()
    function Example() {
      const [isOpen, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>New material</button>
          <CreationModalShell
            isOpen={isOpen}
            title="New material"
            titleId="new-material-title"
            closeLabel="Close material"
            onClose={() => setOpen(false)}
            tall
            showTitle
            headerCenter={<span role="status">Saved</span>}
            footer={<button onClick={() => setOpen(false)}>Save draft</button>}
          >
            <input aria-label="Title" data-modal-initial-focus="" />
          </CreationModalShell>
        </>
      )
    }
    render(<Example />)
    const opener = screen.getByRole('button', { name: 'New material' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'New material' })
    expect(dialog).toHaveClass('h-[90dvh]')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('heading', { name: 'New material' })).not.toHaveClass('sr-only')
    expect(within(dialog).getByRole('status')).toHaveTextContent('Saved')
    const save = within(dialog).getByRole('button', { name: 'Save draft' })
    const body = within(dialog).getByRole('textbox', { name: 'Title' }).parentElement!
    expect(body).toHaveClass('overflow-y-auto')
    expect(body).not.toContainElement(save)
    expect(save.parentElement).toHaveClass('shrink-0')
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveFocus())
    save.focus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Close material' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(opener).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('blocks close requests while closing is disabled', () => {
    const onClose = vi.fn()

    render(
      <CreationModalShell
        isOpen
        title="Create survey"
        titleId="create-survey-title"
        closeLabel="Close survey editor"
        closeDisabled
        onClose={onClose}
      >
        <p>Survey fields</p>
      </CreationModalShell>,
    )

    const closeButton = screen.getByRole('button', { name: 'Close survey editor' })
    expect(closeButton).toBeDisabled()
    fireEvent.click(closeButton)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
  })
})
