import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import type { TiptapContent } from '@/types'

describe('RichTextViewer', () => {
  it('uses persisted authoring source for material preview and student reading, including inline images', () => {
    render(<RichTextViewer content={{ type: 'doc', attrs: {
      authoring_markdown: 'Before ![Wetland](/api/teacher/images/wetland.png) after.\n\n**Read this.**',
    }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Stale compatibility content' }] }] }} />)
    expect(screen.getByRole('img', { name: 'Wetland' })).toHaveAttribute('src', '/api/teacher/images/wetland.png')
    expect(screen.getByText(/Before/)).toHaveTextContent('Before after.')
    expect(screen.getByText('Read this.').tagName).toBe('STRONG')
    expect(screen.queryByText('Stale compatibility content')).not.toBeInTheDocument()
  })

  it('keeps source-backed plain text and empty source authoritative', () => {
    const { rerender } = render(<RichTextViewer content={{ type: 'doc', attrs: { authoring_markdown: '**Reading**' } }} showPlainText />)
    expect(screen.getByText('Reading').tagName).toBe('PRE')
    rerender(<RichTextViewer content={{ type: 'doc', attrs: { authoring_markdown: '' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Legacy content' }] }] }} />)
    expect(screen.queryByText('Legacy content')).not.toBeInTheDocument()
  })

  it('retains protected managed images for legacy documents without authoring source', async () => {
    render(<RichTextViewer content={{ type: 'doc', content: [{ type: 'image', attrs: {
      src: '', alt: 'Legacy diagram', managed_object_id: 'managed-legacy-image',
    } }] }} />)
    expect(await screen.findByRole('img', { name: 'Legacy diagram' })).toHaveAttribute('src', '/api/storage/submission-images?object_id=managed-legacy-image')
  })

  it('preserves surrounding work when a saved document contains an unfinished image upload', async () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Work before the upload.' }],
        },
        {
          type: 'imageUpload',
          attrs: {
            accept: 'image/*',
            limit: 1,
            maxSize: 10_000_000,
          },
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Work after the upload.' }],
        },
      ],
    }

    render(<RichTextViewer content={content} />)

    expect(await screen.findByText('Work before the upload.')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Image upload was not completed')
    expect(screen.getByText('Work after the upload.')).toBeInTheDocument()
  })

  it('preserves unfinished image uploads in plain-text mode', async () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before.' }] },
        { type: 'imageUpload' },
        { type: 'paragraph', content: [{ type: 'text', text: 'After.' }] },
      ],
    }

    render(<RichTextViewer content={content} showPlainText />)

    expect(await screen.findByText(/Before\.\s*Image upload was not completed\s*After\./)).toBeInTheDocument()
  })
})
