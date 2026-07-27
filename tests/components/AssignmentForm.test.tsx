import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssignmentForm } from '@/components/AssignmentForm'

describe('AssignmentForm', () => {
  it('presents instructions as a labelled Markdown-safe WYSIWYG field', async () => {
    render(
      <AssignmentForm
        title="Essay"
        instructionsMarkdown="Explain **why**."
        dueAt=""
        onTitleChange={vi.fn()}
        onInstructionsMarkdownChange={vi.fn()}
        onDueAtChange={vi.fn()}
      />,
    )

    const instructions = await screen.findByRole('textbox', { name: 'Instructions' })
    expect(instructions).toHaveAttribute('contenteditable', 'true')
    expect(instructions).toHaveTextContent('Explain why.')
    expect(screen.getByText('Students see this before they begin.')).toBeInTheDocument()
    expect(
      within(instructions.closest('.simple-editor-wrapper')!)
        .getByRole('toolbar', { name: 'Formatting options' }),
    ).toHaveAttribute('data-toolbar-preset', 'markdown-safe')
  })
})
