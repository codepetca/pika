import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import type { TiptapContent } from '@/types'

describe('RichTextViewer', () => {
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
})
