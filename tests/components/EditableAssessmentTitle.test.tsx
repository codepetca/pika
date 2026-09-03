import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EditableAssessmentTitle } from '@/components/assessment/EditableAssessmentTitle'
import { ModalLayer } from '@/ui'

describe('EditableAssessmentTitle', () => {
  it('handles Escape inside the title editor without closing its dialog', () => {
    const onCancel = vi.fn()
    const onClose = vi.fn()
    const onSave = vi.fn()

    render(
      <ModalLayer isOpen onClose={onClose} ariaLabel="Test authoring">
        <EditableAssessmentTitle
          title="Untitled 2026-05-14 10:45:00"
          inputLabel="Test title"
          editLabel="Edit test title"
          generatedTitleLabel="Untitled Test"
          onCancel={onCancel}
          onSave={onSave}
        />
      </ModalLayer>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit test title' }))
    const input = screen.getByRole('textbox', { name: 'Test title' })
    fireEvent.change(input, { target: { value: 'Typed but cancelled' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Edit test title' })).toHaveTextContent('Untitled Test')
  })
})
