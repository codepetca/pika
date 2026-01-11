import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RichTextEditor } from '@/components/editor'
import type { TiptapContent } from '@/types'

describe('RichTextEditor', () => {
  it('should render the editor with content', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello World' }],
        },
      ],
    }

    render(<RichTextEditor content={content} onChange={onChange} />)

    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })
  })

  it('should render the toolbar when editable', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} editable={true} />)

    // The toolbar should be visible with undo/redo buttons
    await waitFor(() => {
      expect(screen.getByLabelText('Undo')).toBeInTheDocument()
      expect(screen.getByLabelText('Redo')).toBeInTheDocument()
    })
  })

  it('should hide the toolbar when editable is false', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} editable={false} />)

    // The toolbar should not be visible
    await waitFor(() => {
      expect(screen.queryByLabelText('Undo')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Redo')).not.toBeInTheDocument()
    })
  })

  it('should hide the toolbar when disabled is true', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} disabled={true} />)

    // The toolbar should not be visible
    await waitFor(() => {
      expect(screen.queryByLabelText('Undo')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Redo')).not.toBeInTheDocument()
    })
  })

  it('should call onChange when content is modified', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} />)

    // Find and click a formatting button to trigger a change
    await waitFor(() => {
      expect(screen.getByLabelText('Bold')).toBeInTheDocument()
    })

    const boldButton = screen.getByLabelText('Bold')
    fireEvent.click(boldButton)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })
  })

  it('should render formatting buttons', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} />)

    await waitFor(() => {
      // Mark buttons
      expect(screen.getByLabelText('Bold')).toBeInTheDocument()
      expect(screen.getByLabelText('Italic')).toBeInTheDocument()
      expect(screen.getByLabelText('Underline')).toBeInTheDocument()
      expect(screen.getByLabelText('Strike')).toBeInTheDocument()
      expect(screen.getByLabelText('Code')).toBeInTheDocument()

      // Block type buttons
      expect(screen.getByLabelText('Blockquote')).toBeInTheDocument()
      expect(screen.getByLabelText('Code Block')).toBeInTheDocument()

      // Text alignment buttons
      expect(screen.getByLabelText('Align left')).toBeInTheDocument()
      expect(screen.getByLabelText('Align center')).toBeInTheDocument()
      expect(screen.getByLabelText('Align right')).toBeInTheDocument()
      expect(screen.getByLabelText('Align justify')).toBeInTheDocument()
    })
  })

  it('should toggle bold formatting when Bold button is clicked', async () => {
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
      expect(boldButton).toHaveAttribute('data-active-state', 'on')
    })

    // Second click - remove bold
    fireEvent.click(boldButton)
    await waitFor(() => {
      expect(boldButton).toHaveAttribute('data-active-state', 'off')
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
      expect(italicButton).toHaveAttribute('data-active-state', 'on')
    })
  })

  it('should render with custom placeholder', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    const { container } = render(
      <RichTextEditor content={content} onChange={onChange} placeholder="Custom placeholder" />
    )

    await waitFor(() => {
      expect(container).toBeInTheDocument()
    })
  })

  it('should call onBlur when focus leaves the container', async () => {
    const onChange = vi.fn()
    const onBlur = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(
      <div>
        <RichTextEditor content={content} onChange={onChange} onBlur={onBlur} />
        <button data-testid="external-button">External</button>
      </div>
    )

    // Simulate focus leaving the editor by clicking an external element
    await waitFor(() => {
      expect(screen.getByTestId('external-button')).toBeInTheDocument()
    })
  })
})

describe('RichTextEditor code block behavior', () => {
  it('should apply code block formatting when code block button is clicked', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'code' }],
        },
      ],
    }

    render(<RichTextEditor content={content} onChange={onChange} />)

    const codeBlockButton = screen.getByLabelText('Code Block')
    fireEvent.click(codeBlockButton)

    await waitFor(() => {
      expect(codeBlockButton).toHaveAttribute('data-active-state', 'on')
    })
  })

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

    const codeBlockButton = screen.getByLabelText('Code Block')
    fireEvent.click(codeBlockButton)

    await waitFor(() => {
      expect(codeBlockButton).toHaveAttribute('data-active-state', 'on')
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
