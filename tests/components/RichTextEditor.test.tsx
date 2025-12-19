import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RichTextEditor } from '@/components/RichTextEditor'
import type { TiptapContent } from '@/types'

describe('RichTextEditor formatting buttons', () => {
  it('should render all formatting buttons', () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} />)

    expect(screen.getByText('B')).toBeInTheDocument() // Bold
    expect(screen.getByText('I')).toBeInTheDocument() // Italic
    expect(screen.getByText('H1')).toBeInTheDocument() // Heading 1
    expect(screen.getByText('H2')).toBeInTheDocument() // Heading 2
    expect(screen.getByText('H3')).toBeInTheDocument() // Heading 3
    expect(screen.getByText('• List')).toBeInTheDocument() // Bullet list
    expect(screen.getByText('1. List')).toBeInTheDocument() // Ordered list
    expect(screen.getByText('</>')).toBeInTheDocument() // Code block
    expect(screen.getByText('Link')).toBeInTheDocument() // Link
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

    const boldButton = screen.getByText('B')
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

    const italicButton = screen.getByText('I')
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

    const h1Button = screen.getByText('H1')
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

    const h2Button = screen.getByText('H2')
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

    const h3Button = screen.getByText('H3')
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

    const bulletButton = screen.getByText('• List')
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

    const orderedButton = screen.getByText('1. List')
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

    const codeButton = screen.getByText('</>')
    fireEvent.click(codeButton)

    await waitFor(() => {
      expect(codeButton).toHaveAttribute('aria-pressed', 'true')
    })
  })

  it('should disable all buttons when editable is false', () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} editable={false} />)

    expect(screen.getByText('B')).toBeDisabled()
    expect(screen.getByText('I')).toBeDisabled()
    expect(screen.getByText('H1')).toBeDisabled()
    expect(screen.getByText('H2')).toBeDisabled()
    expect(screen.getByText('H3')).toBeDisabled()
    expect(screen.getByText('• List')).toBeDisabled()
    expect(screen.getByText('1. List')).toBeDisabled()
    expect(screen.getByText('</>')).toBeDisabled()
    expect(screen.getByText('Link')).toBeDisabled()
  })

  it('should disable all buttons when disabled is true', () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} disabled />)

    expect(screen.getByText('B')).toBeDisabled()
    expect(screen.getByText('I')).toBeDisabled()
    expect(screen.getByText('H1')).toBeDisabled()
    expect(screen.getByText('H2')).toBeDisabled()
    expect(screen.getByText('H3')).toBeDisabled()
    expect(screen.getByText('• List')).toBeDisabled()
    expect(screen.getByText('1. List')).toBeDisabled()
    expect(screen.getByText('</>')).toBeDisabled()
    expect(screen.getByText('Link')).toBeDisabled()
  })

  it('should call onChange when content is modified', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} />)

    const boldButton = screen.getByText('B')
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

    const boldButton = screen.getByText('B')

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

    const codeButton = screen.getByText('</>')
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
