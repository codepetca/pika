import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssignmentForm } from '@/components/AssignmentForm'

describe('AssignmentForm', () => {
  it('uses placeholders while keeping Title and Instructions as accessible labels', async () => {
    render(
      <AssignmentForm
        title=""
        instructionsMarkdown=""
        dueAt=""
        onTitleChange={vi.fn()}
        onInstructionsMarkdownChange={vi.fn()}
        onDueAtChange={vi.fn()}
      />,
    )

    const title = screen.getByRole('textbox', { name: 'Title' })
    const titleLabel = document.getElementById(title.getAttribute('aria-labelledby')!)
    expect(title).toHaveAttribute('placeholder', 'Title')
    expect(titleLabel).toHaveClass('sr-only')

    const instructions = await screen.findByRole('textbox', { name: 'Instructions' })
    const instructionsLabel = document.getElementById(instructions.getAttribute('aria-labelledby')!)
    expect(instructionsLabel).toHaveClass('sr-only')
    expect(instructions.querySelector('[data-placeholder="Instructions"]')).not.toBeNull()
  })

  it('edits Markdown source without converting it through the visual editor', () => {
    const onChange = vi.fn()
    render(<AssignmentForm title="Essay" instructionsMarkdown="Explain **why**."
      instructionsMode="markdown" dueAt="" onTitleChange={vi.fn()}
      onInstructionsMarkdownChange={onChange} onDueAtChange={vi.fn()} />)
    const source = screen.getByRole('textbox', { name: 'Instructions Markdown' })
    expect(source).toHaveValue('Explain **why**.')
    fireEvent.change(source, { target: { value: '# New instructions\n\n- First' } })
    expect(onChange).toHaveBeenCalledWith('# New instructions\n\n- First')
    expect(screen.queryByRole('toolbar', { name: 'Formatting options' })).not.toBeInTheDocument()
  })

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

  it('places the relative due date inside the date button as a subtitle', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T16:00:00.000Z'))

    try {
      render(
        <AssignmentForm
          title="Essay"
          instructionsMarkdown=""
          dueAt="2026-09-01"
          onTitleChange={vi.fn()}
          onInstructionsMarkdownChange={vi.fn()}
          onDueAtChange={vi.fn()}
        />,
      )

      const dueDate = screen.getByRole('button', { name: 'Tue Sep 1' })
      expect(dueDate).toHaveAccessibleDescription('Tomorrow')
      expect(within(dueDate).getByText('Tomorrow')).toHaveClass('text-xs', 'font-normal')
      expect(screen.queryByText('Due tomorrow')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
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
    expect(screen.queryByText('Students see this before they begin.')).not.toBeInTheDocument()
    expect(
      within(instructions.closest('.simple-editor-wrapper')!)
        .getByRole('toolbar', { name: 'Formatting options' }),
    ).toHaveAttribute('data-toolbar-preset', 'markdown-safe')
  })
})
