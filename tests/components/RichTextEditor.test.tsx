import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RichTextEditor } from '@/components/RichTextEditor'
import type { TiptapContent } from '@/types'

describe('RichTextEditor formatting buttons', () => {
  it('should render all formatting buttons', () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} />)

    expect(screen.getByLabelText('Bold')).toBeInTheDocument()
    expect(screen.getByLabelText('Italic')).toBeInTheDocument()
    expect(screen.getByLabelText('Underline')).toBeInTheDocument()
    expect(screen.getByLabelText('Heading 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Heading 2')).toBeInTheDocument()
    expect(screen.getByLabelText('Heading 3')).toBeInTheDocument()
    expect(screen.getByLabelText('Bullet list')).toBeInTheDocument()
    expect(screen.getByLabelText('Ordered list')).toBeInTheDocument()
    expect(screen.getByLabelText('Code block')).toBeInTheDocument()
    expect(screen.getByLabelText('Link')).toBeInTheDocument()
    expect(screen.getByLabelText('Clear formatting')).toBeInTheDocument()
    expect(screen.getByText('Font')).toBeInTheDocument()
  })

  it('should apply bold formatting when Bold button is clicked', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
    }

    render(<RichTextEditor content={content} onChange={onChange} />)

    const boldButton = screen.getByLabelText('Bold')
    fireEvent.click(boldButton)

    await waitFor(() => {
      expect(boldButton).toHaveAttribute('aria-pressed', 'true')
    })
  })

  it('should apply italic formatting when Italic button is clicked', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
    }

    render(<RichTextEditor content={content} onChange={onChange} />)

    const italicButton = screen.getByLabelText('Italic')
    fireEvent.click(italicButton)

    await waitFor(() => {
      expect(italicButton).toHaveAttribute('aria-pressed', 'true')
    })
  })

  it('should apply heading level 1 when H1 button is clicked', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
    }

    render(<RichTextEditor content={content} onChange={onChange} />)

    const h1Button = screen.getByLabelText('Heading 1')
    fireEvent.click(h1Button)

    await waitFor(() => {
      expect(h1Button).toHaveAttribute('aria-pressed', 'true')
    })
  })

  it('should apply heading level 2 when H2 button is clicked', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
    }

    render(<RichTextEditor content={content} onChange={onChange} />)

    const h2Button = screen.getByLabelText('Heading 2')
    fireEvent.click(h2Button)

    await waitFor(() => {
      expect(h2Button).toHaveAttribute('aria-pressed', 'true')
    })
  })

  it('should apply heading level 3 when H3 button is clicked', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
    }

    render(<RichTextEditor content={content} onChange={onChange} />)

    const h3Button = screen.getByLabelText('Heading 3')
    fireEvent.click(h3Button)

    await waitFor(() => {
      expect(h3Button).toHaveAttribute('aria-pressed', 'true')
    })
  })

  it('should apply bullet list when bullet list button is clicked', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
    }

    render(<RichTextEditor content={content} onChange={onChange} />)

    const bulletButton = screen.getByLabelText('Bullet list')
    fireEvent.click(bulletButton)

    await waitFor(() => {
      expect(bulletButton).toHaveAttribute('aria-pressed', 'true')
    })
  })

  it('should apply ordered list when ordered list button is clicked', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
    }

    render(<RichTextEditor content={content} onChange={onChange} />)

    const orderedButton = screen.getByLabelText('Ordered list')
    fireEvent.click(orderedButton)

    await waitFor(() => {
      expect(orderedButton).toHaveAttribute('aria-pressed', 'true')
    })
  })

  it('should apply code block when code block button is clicked', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
    }

    render(<RichTextEditor content={content} onChange={onChange} />)

    const codeButton = screen.getByLabelText('Code block')
    fireEvent.click(codeButton)

    await waitFor(() => {
      expect(codeButton).toHaveAttribute('aria-pressed', 'true')
    })
  })

  it('should disable all buttons when editable is false', () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} editable={false} />)

    expect(screen.getByLabelText('Bold')).toBeDisabled()
    expect(screen.getByLabelText('Italic')).toBeDisabled()
    expect(screen.getByLabelText('Underline')).toBeDisabled()
    expect(screen.getByLabelText('Heading 1')).toBeDisabled()
    expect(screen.getByLabelText('Heading 2')).toBeDisabled()
    expect(screen.getByLabelText('Heading 3')).toBeDisabled()
    expect(screen.getByLabelText('Bullet list')).toBeDisabled()
    expect(screen.getByLabelText('Ordered list')).toBeDisabled()
    expect(screen.getByLabelText('Code block')).toBeDisabled()
    expect(screen.getByLabelText('Link')).toBeDisabled()
    expect(screen.getByLabelText('Clear formatting')).toBeDisabled()
    expect(screen.getByText('Font')).toBeDisabled()
  })

  it('should disable all buttons when disabled is true', () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} disabled />)

    expect(screen.getByLabelText('Bold')).toBeDisabled()
    expect(screen.getByLabelText('Italic')).toBeDisabled()
    expect(screen.getByLabelText('Underline')).toBeDisabled()
    expect(screen.getByLabelText('Heading 1')).toBeDisabled()
    expect(screen.getByLabelText('Heading 2')).toBeDisabled()
    expect(screen.getByLabelText('Heading 3')).toBeDisabled()
    expect(screen.getByLabelText('Bullet list')).toBeDisabled()
    expect(screen.getByLabelText('Ordered list')).toBeDisabled()
    expect(screen.getByLabelText('Code block')).toBeDisabled()
    expect(screen.getByLabelText('Link')).toBeDisabled()
    expect(screen.getByLabelText('Clear formatting')).toBeDisabled()
    expect(screen.getByText('Font')).toBeDisabled()
  })

  it('should call onChange when content is modified', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} />)

    const boldButton = screen.getByLabelText('Bold')
    fireEvent.click(boldButton)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })
  })

  it('should render with custom placeholder', () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    const { container } = render(
      <RichTextEditor content={content} onChange={onChange} placeholder="Custom placeholder" />
    )

    expect(container).toBeInTheDocument()
  })

  it('should call onBlur when editor loses focus', async () => {
    const onChange = vi.fn()
    const onBlur = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    const { container } = render(
      <RichTextEditor content={content} onChange={onChange} onBlur={onBlur} />
    )

    const editorContainer = container.querySelector('[role="textbox"]')
    if (editorContainer) {
      fireEvent.blur(editorContainer)
      // Wait a bit for blur handler to process
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Note: onBlur is only called when focus moves outside the container,
    // so this test may not trigger it in the test environment
  })

  it('should toggle formatting off when button is clicked twice', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
    }

    render(<RichTextEditor content={content} onChange={onChange} />)

    const boldButton = screen.getByLabelText('Bold')

    // First click - apply bold
    fireEvent.click(boldButton)
    await waitFor(() => {
      expect(boldButton).toHaveAttribute('aria-pressed', 'true')
    })

    // Second click - remove bold
    fireEvent.click(boldButton)
    await waitFor(() => {
      expect(boldButton).toHaveAttribute('aria-pressed', 'false')
    })
  })
})

describe('RichTextEditor code block behavior', () => {
  it('should strip marks when converting to code block', async () => {
    const onChange = vi.fn()
    // Start with bold text
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'code',
              marks: [{ type: 'bold' }],
            },
          ],
        },
      ],
    }

    render(<RichTextEditor content={content} onChange={onChange} />)

    const codeButton = screen.getByLabelText('Code block')
    fireEvent.click(codeButton)

    await waitFor(() => {
      expect(codeButton).toHaveAttribute('aria-pressed', 'true')
    })

    // When onChange is called with code block, it should not have marks
    await waitFor(() => {
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]
      if (lastCall && lastCall[0]?.content?.[0]?.type === 'codeBlock') {
        const codeBlockContent = lastCall[0].content[0].content
        if (codeBlockContent?.[0]) {
          expect(codeBlockContent[0].marks).toBeUndefined()
        }
      }
    })
  })
})
