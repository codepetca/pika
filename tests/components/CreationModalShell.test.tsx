import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CreationModalShell } from '@/components/creation/CreationModalShell'

describe('CreationModalShell', () => {
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
    expect(screen.getByText('Assignment fields')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close assignment editor' }))
    expect(onClose).toHaveBeenCalledOnce()
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
