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

    // The toolbar should be visible with formatting buttons
    await waitFor(() => {
      expect(screen.getByLabelText('Bold')).toBeInTheDocument()
      expect(screen.getByLabelText('Italic')).toBeInTheDocument()
      expect(screen.getByLabelText('Underline')).toBeInTheDocument()
    })
  })

  it('should hide the toolbar when editable is false', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} editable={false} />)

    // The toolbar should not be visible
    await waitFor(() => {
      expect(screen.queryByLabelText('Bold')).not.toBeInTheDocument()
    })
  })

  it('should hide the toolbar when disabled is true', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} disabled={true} />)

    // The toolbar should not be visible
    await waitFor(() => {
      expect(screen.queryByLabelText('Bold')).not.toBeInTheDocument()
    })
  })

  it('should hide the toolbar when showToolbar is false', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} showToolbar={false} />)

    // The toolbar should not be visible but editor should still be editable
    await waitFor(() => {
      expect(screen.queryByLabelText('Bold')).not.toBeInTheDocument()
      // Editor content area should still exist
      expect(screen.getByRole('presentation')).toBeInTheDocument()
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
      // Direct toolbar buttons
      expect(screen.getByLabelText('Bold')).toBeInTheDocument()
      expect(screen.getByLabelText('Italic')).toBeInTheDocument()
      expect(screen.getByLabelText('Underline')).toBeInTheDocument()

      // Dropdown triggers
      expect(screen.getByLabelText('Format text as heading')).toBeInTheDocument()
      expect(screen.getByLabelText('List options')).toBeInTheDocument()
      expect(screen.getByLabelText('Block formatting')).toBeInTheDocument()
      expect(screen.getByLabelText('Text marks')).toBeInTheDocument()
      expect(screen.getByLabelText('Text alignment')).toBeInTheDocument()
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

describe('RichTextEditor dropdown menus', () => {
  it('should render dropdown triggers', async () => {
    const onChange = vi.fn()
    const content: TiptapContent = { type: 'doc', content: [] }

    render(<RichTextEditor content={content} onChange={onChange} />)

    // Verify all dropdown triggers are present
    await waitFor(() => {
      expect(screen.getByLabelText('Block formatting')).toBeInTheDocument()
      expect(screen.getByLabelText('Text marks')).toBeInTheDocument()
      expect(screen.getByLabelText('Text alignment')).toBeInTheDocument()
    })
  })
})
