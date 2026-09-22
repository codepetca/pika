import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RichTextEditor } from '@/components/editor'
import { ImageUploadButton } from '@/components/tiptap-ui/image-upload-button/image-upload-button'
import { useImageUpload } from '@/components/tiptap-ui/image-upload-button/use-image-upload'

describe('ImageUploadButton', () => {
  it('opens the labeled native picker without changing the editor document', async () => {
    expect(ImageUploadButton).toBeDefined()
    expect(useImageUpload).toBeTypeOf('function')
    const onChange = vi.fn()
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})

    try {
      render(
        <RichTextEditor
          content={{ type: 'doc', content: [] }}
          onChange={onChange}
          assignmentDocId="assignment-doc-1"
          enableImageUpload
        />,
      )

      const action = await screen.findByRole('button', { name: 'Add image' })
      expect(action).toBeEnabled()
      expect(screen.getByLabelText('Choose image')).toHaveAttribute('type', 'file')

      await userEvent.click(action)

      expect(clickSpy).toHaveBeenCalledOnce()
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      clickSpy.mockRestore()
    }
  })
})
