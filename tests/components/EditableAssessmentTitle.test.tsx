import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { EditableAssessmentTitle } from '@/components/assessment/EditableAssessmentTitle'
import { ModalLayer } from '@/ui'

describe('EditableAssessmentTitle', () => {
  it('saves a Test title on Escape without closing its dialog', async () => {
    const onCancel = vi.fn()
    const onClose = vi.fn()
    const onSave = vi.fn()

    function Harness() {
      const [title, setTitle] = useState('Untitled 2026-05-14 10:45:00')
      return (
        <EditableAssessmentTitle
          title={title}
          inputLabel="Test title"
          editLabel="Edit test title"
          generatedTitleLabel="Untitled Test"
          saveOnEscape
          onCancel={onCancel}
          onSave={(nextTitle) => {
            onSave(nextTitle)
            setTitle(nextTitle)
          }}
        />
      )
    }

    render(
      <ModalLayer isOpen onClose={onClose} ariaLabel="Test authoring">
        <Harness />
      </ModalLayer>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit test title' }))
    const input = screen.getByRole('textbox', { name: 'Test title' })
    fireEvent.change(input, { target: { value: 'Typed on Escape' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit test title' })).toHaveTextContent('Typed on Escape')
    })
    expect(onCancel).not.toHaveBeenCalled()
    expect(onSave).toHaveBeenCalledWith('Typed on Escape')
    expect(onClose).not.toHaveBeenCalled()
  })
})
