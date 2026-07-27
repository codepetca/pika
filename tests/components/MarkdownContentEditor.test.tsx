import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownContentEditor } from '@/components/editor'

describe('MarkdownContentEditor', () => {
  it('renders markdown as WYSIWYG content and emits markdown after edits', async () => {
    const user = userEvent.setup()
    const onMarkdownChange = vi.fn()

    render(
      <MarkdownContentEditor
        markdown="**Important** instructions"
        onMarkdownChange={onMarkdownChange}
        aria-label="Instructions"
        toolbarPreset="compact"
      />,
    )

    const editor = await screen.findByRole('textbox', { name: 'Instructions' })
    expect(editor).toHaveTextContent('Important instructions')
    expect(editor.querySelector('strong')).toHaveTextContent('Important')

    editor.focus()
    await user.keyboard(' today')

    const emittedMarkdown = onMarkdownChange.mock.lastCall?.[0]
    expect(emittedMarkdown).toContain('today')
    expect(emittedMarkdown).toContain('**Important**')
  })

  it('synchronizes external markdown without reporting a user edit', async () => {
    const onMarkdownChange = vi.fn()
    const { rerender } = render(
      <MarkdownContentEditor
        markdown=""
        onMarkdownChange={onMarkdownChange}
        disabled
      />,
    )

    await screen.findByRole('document')
    onMarkdownChange.mockClear()

    rerender(
      <MarkdownContentEditor
        markdown="Loaded prompt"
        onMarkdownChange={onMarkdownChange}
      />,
    )

    expect(await screen.findByRole('textbox')).toHaveTextContent('Loaded prompt')
    expect(onMarkdownChange).not.toHaveBeenCalled()
  })
})
