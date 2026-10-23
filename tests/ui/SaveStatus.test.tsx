import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SaveStatus, type SaveStatusState } from '@/ui'

describe('SaveStatus', () => {
  it('shows a circular saving indicator while keeping quiet states announced and errors visible', () => {
    const { rerender } = render(<SaveStatus presentation="indicator" status="saving" />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Saving…')
    expect(status.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText('Saving…')).toHaveClass('sr-only')
    for (const state of ['saved', 'unsaved'] as const) {
      rerender(<SaveStatus presentation="indicator" status={state} />)
      expect(status.querySelector('svg')).not.toBeInTheDocument()
      expect(status.firstElementChild).toHaveClass('sr-only')
    }
    rerender(<SaveStatus presentation="indicator" status="error" errorMessage="Try saving again" />)
    expect(status).toHaveTextContent('Try saving again')
    expect(status).not.toHaveClass('sr-only')
  })
  it.each([
    ['saved', 'Saved'],
    ['saving', 'Saving…'],
    ['unsaved', 'Unsaved'],
    ['error', 'Save failed'],
  ] satisfies Array<[SaveStatusState, string]>)(
    'renders %s as an announced status',
    (status, label) => {
      render(<SaveStatus status={status} />)

      const indicator = screen.getByRole('status')
      expect(indicator).toHaveTextContent(label)
      expect(indicator).toHaveAttribute('aria-live', 'polite')
      expect(indicator).toHaveAttribute('aria-atomic', 'true')
    },
  )
})
