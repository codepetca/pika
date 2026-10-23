// Uses the real RichTextEditor: compact toolbar, image dialog, and source emission.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('renders saved images and preserves their Markdown through a real visual edit', async () => {
    const user = userEvent.setup()
    const onMarkdownChange = vi.fn()
    render(<MarkdownContentEditor markdown="Before ![Wetland](https://example.com/wetland.png) after."
      onMarkdownChange={onMarkdownChange} aria-label="Prompt" toolbarPreset="markdown-authoring" />)
    const editor = await screen.findByRole('textbox', { name: 'Prompt' })
    expect(editor.querySelector('img')).toHaveAttribute('src', 'https://example.com/wetland.png')
    editor.focus()
    await user.keyboard(' More detail')
    expect(onMarkdownChange.mock.lastCall?.[0]).toContain('![Wetland](https://example.com/wetland.png)')
    expect(onMarkdownChange.mock.lastCall?.[0]).toContain('More detail')
  })

  it('inserts an image at the selected position and emits image Markdown to its caller', async () => {
    const user = userEvent.setup()
    const onMarkdownChange = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })))
    try {
      render(<MarkdownContentEditor markdown="Prompt" onMarkdownChange={onMarkdownChange}
        toolbarPreset="markdown-authoring" aria-label="Prompt" />)
      await screen.findByRole('textbox', { name: 'Prompt' })
      await user.click(screen.getByRole('button', { name: 'Insert image' }))
      fireEvent.change(screen.getByRole('textbox', { name: 'Image URL' }), { target: { value: 'https://example.com/diagram.png' } })
      fireEvent.load(await screen.findByTestId('markdown-image-preview'))
      await user.type(screen.getByRole('textbox', { name: 'Image description' }), 'Wetland diagram')
      await user.click(screen.getByRole('button', { name: 'Insert image' }))
      await waitFor(() => expect(onMarkdownChange.mock.lastCall?.[0]).toContain('![Wetland diagram](https://example.com/diagram.png)'))
      expect(screen.getByRole('img', { name: 'Wetland diagram' })).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    } finally { vi.unstubAllGlobals() }
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
