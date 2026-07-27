import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ContentField, RichTextEditor } from '@/components/editor'
import type { TiptapContent } from '@/types'

const EMPTY_CONTENT: TiptapContent = { type: 'doc', content: [] }

describe('ContentField', () => {
  it('connects its label, hint, and error to the editor', async () => {
    render(
      <ContentField
        label="Assignment instructions"
        hint="Students see this before they begin."
        error="Instructions are required."
        required
      >
        <RichTextEditor content={EMPTY_CONTENT} onChange={vi.fn()} toolbarPreset="compact" />
      </ContentField>,
    )

    const editor = await screen.findByRole('textbox', { name: 'Assignment instructions' })
    const describedBy = editor.getAttribute('aria-describedby')?.split(' ') ?? []

    expect(editor).toHaveAttribute('aria-required', 'true')
    expect(editor).toHaveAttribute('aria-invalid', 'true')
    expect(describedBy).toContain(`${editor.id}-hint`)
    expect(describedBy).toContain(`${editor.id}-error`)
  })

  it('shows a live autosave status in the label row', async () => {
    render(
      <ContentField label="Material content" saveStatus="saving">
        <RichTextEditor content={EMPTY_CONTENT} onChange={vi.fn()} />
      </ContentField>,
    )

    expect(await screen.findByRole('status')).toHaveTextContent('Saving…')
  })

  it('shows a useful save failure message', async () => {
    render(
      <ContentField
        label="Material content"
        saveStatus="error"
        saveErrorMessage="Could not save. Try again."
      >
        <RichTextEditor content={EMPTY_CONTENT} onChange={vi.fn()} />
      </ContentField>,
    )

    expect(await screen.findByRole('status')).toHaveTextContent('Could not save. Try again.')
  })
})
