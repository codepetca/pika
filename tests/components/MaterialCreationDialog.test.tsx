import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MaterialCreationDialog } from '@/components/materials/MaterialCreationDialog'
import { TooltipProvider } from '@/ui'

vi.mock('@/components/editor', () => ({
  ContentField: ({ children, label }: any) => <div>{label}{children}</div>,
  RichTextEditor: ({ content, editable, onChange }: any) => <textarea aria-label="Material content" disabled={!editable}
    value={content.content?.map((node: any) => node.content?.map((child: any) => child.text).join('')).join('\n')}
    onChange={(event) => onChange({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: event.target.value }] }] })} />,
  RichTextViewer: ({ content }: any) => <div>{content.content?.map((node: any) => node.content?.map((child: any) => child.text).join('')).join('\n')}</div>,
}))

const props = () => ({
  isOpen: true, title: 'Field guide',
  content: { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unsaved reading content' }] }] },
  onTitleChange: vi.fn(), onContentChange: vi.fn(), onSave: vi.fn(), onClose: vi.fn(),
})

// MaterialCreationPattern renders this production owner; shared editor, preview and action
// contracts below also cover the deterministic Pattern Lab composition.
describe('Material formatted editing', () => {
  it('edits directly in one editor, previews current changes and saves only on explicit action', async () => {
    const user = userEvent.setup()
    const handlers = props()
    function ControlledEditor() {
      const [content, setContent] = useState(handlers.content)
      return <MaterialCreationDialog {...handlers} content={content} onContentChange={(next) => { handlers.onContentChange(next); setContent(next as typeof content) }} />
    }
    render(<ControlledEditor />, { wrapper: TooltipProvider })
    expect(screen.queryByRole('button', { name: /^(Visual|Markdown|Apply Markdown|Discard Markdown)$/ })).not.toBeInTheDocument()
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
