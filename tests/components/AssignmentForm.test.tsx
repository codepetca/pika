import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssignmentForm } from '@/components/AssignmentForm'

describe('AssignmentForm', () => {
  it('keeps authoring actions outside the scrollable fields in fill-height mode', async () => {
    render(
      <AssignmentForm
        fillHeight
        title="Essay"
        instructionsMarkdown="Explain why."
        dueAt=""
        onTitleChange={vi.fn()}
        onInstructionsMarkdownChange={vi.fn()}
        onDueAtChange={vi.fn()}
        extraFields={<button>Configure required submissions</button>}
        topRowActions={<button>Post assignment</button>}
      />,
    )
    const instructions = await screen.findByRole('textbox', { name: 'Instructions' })
    const body = instructions.closest('.overflow-y-auto')!
    expect(body).toContainElement(screen.getByRole('button', { name: 'Configure required submissions' }))
    expect(body).not.toContainElement(screen.getByRole('button', { name: 'Post assignment' }))
    expect(body).not.toContainElement(screen.getByRole('textbox', { name: /Title/ }))
    expect(instructions.closest('.simple-editor-wrapper')).toHaveClass('simple-editor-wrapper--fill-height')
  })

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
