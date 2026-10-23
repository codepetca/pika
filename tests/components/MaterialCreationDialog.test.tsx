import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MaterialCreationDialog } from '@/components/materials/MaterialCreationDialog'
import { TooltipProvider } from '@/ui'
import { getMaterialMarkdownSource } from '@/lib/material-markdown'
import { uploadMarkdownImage } from '@/lib/markdown-image-upload'
vi.mock('@/lib/markdown-image-upload', () => ({ uploadMarkdownImage: vi.fn() }))

vi.mock('@/components/editor', () => ({
  MarkdownAuthoringEditor: ({ markdown, onMarkdownChange, visualContent, onVisualContentChange, disabled, mode, onModeChange, statusContent, imageUpload }: any) => (
    <div>
      <div>
        {statusContent}
        <button onClick={() => onModeChange('visual')}>Write</button>
        <button onClick={() => onModeChange('markdown')}>Markdown</button>
      </div>
      {imageUpload && <button onClick={() => void imageUpload(new File(['png'], 'diagram.png', { type: 'image/png' }))}>Upload fixture image</button>}
      <textarea
        aria-label={mode === 'markdown' ? 'Material content Markdown' : 'Material content'}
        disabled={disabled}
        value={mode === 'markdown' ? markdown : visualContent.content?.map((node: any) => node.content?.map((child: any) => child.text).join('')).join('\n')}
        onChange={event => {
          if (mode === 'markdown') onMarkdownChange(event.target.value)
          else onVisualContentChange({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: event.target.value }] }] })
        }}
      />
    </div>
  ),
  RichTextViewer: ({ content }: any) => <div>{content.content?.map((node: any) => node.content?.map((child: any) => child.text).join('')).join('\n')}</div>,
}))

const props = () => ({
  isOpen: true, title: 'Field guide', classroomName: 'Health for Life',
  content: { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unsaved reading content' }] }] },
  onTitleChange: vi.fn(), onContentChange: vi.fn(), onSave: vi.fn(), onClose: vi.fn(),
})

// MaterialCreationPattern renders this production owner; shared editor, preview and action
// contracts below also cover the deterministic Pattern Lab composition.
describe('Material formatted editing', () => {
  it('uses the TeacherClassroomView classroom context for image uploads', async () => {
    const user = userEvent.setup()
    vi.mocked(uploadMarkdownImage).mockResolvedValue('/api/storage/authoring-images?object_id=11111111-1111-4111-8111-111111111111')
    render(<MaterialCreationDialog {...props()} classroomId="owner-classroom" />, { wrapper: TooltipProvider })
    await user.click(screen.getByRole('button', { name: 'Upload fixture image' }))
    expect(uploadMarkdownImage).toHaveBeenCalledWith('owner-classroom', expect.objectContaining({ name: 'diagram.png' }), undefined)
  })

  it('keeps the context header separate from details and preserves literal Markdown through save and reopen', async () => {
    // Actual-owner Playwright captures cover responsive row sizing; this suite
    // retains the accessible header/details order and source round-trip contract.
    const user = userEvent.setup()
    const handlers = props()
    let latestContent = handlers.content
    function ControlledEditor() {
      const [content, setContent] = useState(handlers.content)
      return <MaterialCreationDialog {...handlers} content={content} onContentChange={next => { latestContent = next as typeof content; handlers.onContentChange(next); setContent(next as typeof content) }} />
    }
    const view = render(<ControlledEditor />, { wrapper: TooltipProvider })
    const details = screen.getByRole('region', { name: 'Material details' })
    const header = screen.getByTitle('Health for Life').closest('.modal-context-row')!
    expect(details).not.toContainElement(header)
    expect(header.nextElementSibling).toBe(details)
    await user.click(screen.getByRole('button', { name: 'Markdown', exact: true }))
    expect(handlers.onContentChange).not.toHaveBeenCalled()
    const markdown = '# Reading\n\n- First  \n- Second\n'
    fireEvent.change(screen.getByRole('textbox', { name: 'Material content Markdown' }), { target: { value: markdown } })
    expect(getMaterialMarkdownSource(latestContent)).toBe(markdown)
    await user.click(screen.getByRole('button', { name: 'Post', exact: true }))
    expect(handlers.onSave).toHaveBeenCalledWith(false)
    view.unmount()
    render(<MaterialCreationDialog {...handlers} content={latestContent} />, { wrapper: TooltipProvider })
    await user.click(screen.getByRole('button', { name: 'Markdown', exact: true }))
    expect(screen.getByRole('textbox', { name: 'Material content Markdown' })).toHaveValue(markdown)
  })

  it('edits directly in one editor, previews current changes and saves only on explicit action', async () => {
    const user = userEvent.setup()
    const handlers = props()
    function ControlledEditor() {
      const [content, setContent] = useState(handlers.content)
      return <MaterialCreationDialog {...handlers} content={content} onContentChange={(next) => { handlers.onContentChange(next); setContent(next as typeof content) }} />
    }
    render(<ControlledEditor />, { wrapper: TooltipProvider })
    expect(screen.getByRole('button', { name: 'Write', exact: true })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Markdown', exact: true })).toBeVisible()
    expect(screen.getByTitle('Health for Life')).toHaveTextContent('Health for Life')
    const close = screen.getByRole('button', { name: 'Close material modal' })
    expect(close.closest('[data-dialog-close]')).toHaveClass('right-3', 'top-3')
    expect(screen.getByRole('dialog').querySelectorAll('[data-dialog-close]')).toHaveLength(1)
    const editor = screen.getByRole('textbox', { name: 'Material content' })
    await user.clear(editor)
    await user.type(editor, 'Updated reading')
    expect(handlers.onContentChange).toHaveBeenCalled()
    expect(handlers.onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Preview', exact: true }))
    expect(within(screen.getByRole('dialog', { name: 'Material preview' })).getByText('Updated reading')).toBeVisible()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Post', exact: true }))
    expect(handlers.onSave).toHaveBeenCalledWith(false)
    await user.click(screen.getByRole('button', { name: 'Close material modal' }))
    expect(handlers.onClose).toHaveBeenCalledOnce()
  })

  it('opens and previews existing rich content without converting or replacing it', async () => {
    const user = userEvent.setup()
    const handlers = props()
    const content = { type: 'doc' as const, content: [{ type: 'image', attrs: { src: 'https://example.com/diagram.png', alt: 'Diagram' } }, ...handlers.content.content] }
    const view = render(<MaterialCreationDialog {...handlers} content={content} />, { wrapper: TooltipProvider })
    await user.click(screen.getByRole('button', { name: 'Preview', exact: true }))
    expect(within(screen.getByRole('dialog', { name: 'Material preview' })).getByText('Unsaved reading content')).toBeVisible()
    expect(handlers.onContentChange).not.toHaveBeenCalled()
    expect(handlers.onSave).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Markdown', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Write', exact: true }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'New title' } })
    await user.click(screen.getByRole('button', { name: 'Post', exact: true }))
    expect(handlers.onContentChange).not.toHaveBeenCalled()
    expect(content.content[0]).toMatchObject({ type: 'image', attrs: { src: 'https://example.com/diagram.png' } })
    view.rerender(<MaterialCreationDialog {...handlers} content={content} readOnly />)
    expect(screen.getByRole('textbox', { name: 'Material content' })).toBeDisabled()
  })
})

describe('Material creation', () => {
  it('previews the current content without saving, and returns focus to Preview', async () => {
    const user = userEvent.setup()
    const handlers = props()
    render(<MaterialCreationDialog {...handlers} />, { wrapper: TooltipProvider })
    expect(screen.getByRole('dialog', { name: 'New Material' })).toBeVisible()
    expect(screen.queryByText('Ungraded classwork')).not.toBeInTheDocument()
    const preview = screen.getByRole('button', { name: 'Preview' })
    expect(preview).toHaveTextContent('Preview')
    await user.click(preview)
    expect(within(screen.getByRole('dialog', { name: 'Material preview' })).getByText('Unsaved reading content')).toBeVisible()
    expect(handlers.onSave).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(preview).toHaveFocus())
    expect(screen.getByRole('dialog', { name: 'New Material' })).toBeVisible()
    expect(handlers.onClose).not.toHaveBeenCalled()
  })

  it('requires an explicit primary click after choosing Save draft and preserves Post', async () => {
    const user = userEvent.setup()
    const handlers = props()
    render(<MaterialCreationDialog {...handlers} />, { wrapper: TooltipProvider })
    await user.click(screen.getByRole('button', { name: 'Choose material action' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Save draft' })).toHaveFocus())
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose material action' })).toHaveFocus())
    expect(handlers.onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save draft', exact: true }))
    expect(handlers.onSave).toHaveBeenLastCalledWith(true)
    await user.click(screen.getByRole('button', { name: 'Choose material action' }))
    await user.click(screen.getByRole('menuitem', { name: 'Post' }))
    await user.click(screen.getByRole('button', { name: 'Post', exact: true }))
    expect(handlers.onSave).toHaveBeenLastCalledWith(false)
  })

  it('keeps delete available for existing items, and blocks mutations when saving or read-only', async () => {
    const user = userEvent.setup()
    const handlers = props()
    const onDelete = vi.fn()
    const { rerender } = render(<MaterialCreationDialog {...handlers} isExisting isDraft={false} onDelete={onDelete} />, { wrapper: TooltipProvider })
    await user.click(screen.getByRole('button', { name: 'Choose material action' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete material' }))
    expect(onDelete).toHaveBeenCalledOnce()
    rerender(<MaterialCreationDialog {...handlers} saving />)
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close material modal' })).toBeDisabled()
    rerender(<MaterialCreationDialog {...handlers} readOnly error="Could not save material" />)
    expect(screen.getByRole('textbox', { name: /^Title/ })).toBeDisabled()
    expect(document.getElementById(screen.getByRole('textbox', { name: /^Title/ }).getAttribute('aria-labelledby')!)).toHaveClass('sr-only')
    expect(screen.getByRole('textbox', { name: /^Title/ })).toHaveAttribute('placeholder', 'Title')
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save material')
  })
})


describe('Material chooser closing', () => {
  it('dismisses the menu within its dialog without saving or closing the material', () => {
    const handlers = props()
    const view = render(<MaterialCreationDialog {...handlers} />, { wrapper: TooltipProvider })
    const trigger = screen.getByRole('button', { name: 'Choose material action' })
    fireEvent.click(trigger)
    screen.getByRole('menu').style.setProperty('--motion-duration-fast', '100ms')
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Save draft' }), { key: 'Escape' })
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(document.querySelector('[data-menu-closing]')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('dialog', { name: 'New Material' })).toBeVisible()
    expect(handlers.onSave).not.toHaveBeenCalled()
    expect(handlers.onClose).not.toHaveBeenCalled()
    view.unmount()
  })

  it.each(['saving', 'readOnly', 'closed'] as const)('immediately retires open and closing presentation when %s', (reason) => {
    const handlers = props()
    const view = render(<MaterialCreationDialog {...handlers} />, { wrapper: TooltipProvider })
    const updated = { ...handlers, saving: reason === 'saving', readOnly: reason === 'readOnly', isOpen: reason !== 'closed' }
    fireEvent.click(screen.getByRole('button', { name: 'Choose material action' }))
    view.rerender(<MaterialCreationDialog {...updated} />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(document.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
    view.rerender(<MaterialCreationDialog {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose material action' }))
    screen.getByRole('menu').style.setProperty('--motion-duration-fast', '100ms')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(document.querySelector('[data-menu-closing]')).toBeInTheDocument()
    view.rerender(<MaterialCreationDialog {...updated} />)
    expect(document.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
    expect(handlers.onSave).not.toHaveBeenCalled()
    view.unmount()
  })
})

describe('Material scheduling', () => {
  it('edits a published post date only on Save and retains it after a failed save', async () => {
    const user = userEvent.setup()
    const handlers = props()
    const view = render(<MaterialCreationDialog {...handlers} isExisting isDraft={false} releasedAt="2026-10-03T01:00:00Z" />, { wrapper: TooltipProvider })
    const field = screen.getByLabelText('Post date (Toronto)')
    expect(field).toHaveValue('2026-10-02')
    fireEvent.change(field, { target: { value: '2026-10-01' } })
    expect(handlers.onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }))
    expect(handlers.onSave).toHaveBeenCalledWith(false, undefined, '2026-10-01')
    view.rerender(<MaterialCreationDialog {...handlers} isExisting isDraft={false} releasedAt="2026-10-03T01:00:00Z" error="Could not save material" />)
    expect(screen.getByLabelText('Post date (Toronto)')).toHaveValue('2026-10-01')
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save material')
  })

  it('blocks empty/future post dates and locks the date field while saving or read-only', () => {
    const handlers = { ...props(), isExisting: true, isDraft: false, releasedAt: '2026-10-03T12:00:00Z' }
    const view = render(<MaterialCreationDialog {...handlers} />, { wrapper: TooltipProvider })
    fireEvent.change(screen.getByLabelText('Post date (Toronto)'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Post date (Toronto)'), { target: { value: '2099-01-01' } })
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    view.rerender(<MaterialCreationDialog {...handlers} saving />)
    expect(screen.getByLabelText('Post date (Toronto)')).toBeDisabled()
    view.rerender(<MaterialCreationDialog {...handlers} readOnly />)
    expect(screen.getByLabelText('Post date (Toronto)')).toBeDisabled()
  })

  it('keeps post-date editing out of new, draft and scheduled materials', () => {
    const handlers = props()
    const view = render(<MaterialCreationDialog {...handlers} />, { wrapper: TooltipProvider })
    expect(screen.queryByLabelText('Post date (Toronto)')).not.toBeInTheDocument()
    view.rerender(<MaterialCreationDialog {...handlers} isExisting isDraft />)
    expect(screen.queryByLabelText('Post date (Toronto)')).not.toBeInTheDocument()
    view.rerender(<MaterialCreationDialog {...handlers} isExisting isDraft={false} releasedAt="2099-07-10T11:00:00Z" />)
    expect(screen.queryByLabelText('Post date (Toronto)')).not.toBeInTheDocument()
  })

  it('uses a legacy published material creation date and preserves Save draft with an invalid post date', async () => {
    const user = userEvent.setup()
    const handlers = props()
    render(<MaterialCreationDialog {...handlers} isExisting isDraft={false} releasedAt={null} createdAt="2026-01-22T01:00:00Z" />, { wrapper: TooltipProvider })
    expect(screen.getByLabelText('Post date (Toronto)')).toHaveValue('2026-01-21')
    fireEvent.change(screen.getByLabelText('Post date (Toronto)'), { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: 'Choose material action' }))
    await user.click(screen.getByRole('menuitem', { name: 'Save draft' }))
    await user.click(screen.getByRole('button', { name: 'Save draft', exact: true }))
    expect(handlers.onSave).toHaveBeenCalledWith(true)
  })

  it('uses assignment-style details and content panes without a due date', () => {
    render(<MaterialCreationDialog {...props()} />, { wrapper: TooltipProvider })
    expect(screen.getByRole('region', { name: 'Material details' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Material editor' })).toBeVisible()
    expect(screen.queryByText(/due date/i)).not.toBeInTheDocument()
  })

  it('requires a future Toronto schedule and an explicit confirm before saving', async () => {
    const user = userEvent.setup()
    const handlers = props()
    render(<MaterialCreationDialog {...handlers} />, { wrapper: TooltipProvider })
    await user.click(screen.getByRole('button', { name: 'Choose material action' }))
    await user.click(screen.getByRole('menuitem', { name: 'Schedule' }))
    expect(handlers.onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Schedule', exact: true }))
    const dialog = screen.getByRole('dialog', { name: 'Schedule Release' })
    fireEvent.change(within(dialog).getByLabelText('Date (Toronto)'), { target: { value: '2099-07-10' } })
    fireEvent.change(within(dialog).getByLabelText('Time (Toronto)'), { target: { value: '07:00' } })
    await user.click(within(dialog).getByRole('button', { name: 'Schedule', exact: true }))
    expect(handlers.onSave).toHaveBeenCalledWith(false, '2099-07-10T11:00:00.000Z')
  })

  it('can post a scheduled material now or return it to a draft', async () => {
    const user = userEvent.setup()
    const handlers = props()
    render(<MaterialCreationDialog {...handlers} isExisting isDraft={false} releasedAt="2099-07-10T11:00:00.000Z" />, { wrapper: TooltipProvider })
    expect(screen.getByText(/Scheduled for/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Choose material action' }))
    await user.click(screen.getByRole('menuitem', { name: 'Post now' }))
    await user.click(screen.getByRole('button', { name: 'Post now', exact: true }))
    expect(handlers.onSave).toHaveBeenLastCalledWith(false, null)
    await user.click(screen.getByRole('button', { name: 'Choose material action' }))
    await user.click(screen.getByRole('menuitem', { name: 'Save draft' }))
    await user.click(screen.getByRole('button', { name: 'Save draft', exact: true }))
    expect(handlers.onSave).toHaveBeenLastCalledWith(true)
  })
})
