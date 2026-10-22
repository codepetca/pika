import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AlertDialog, ConfirmDialog, ContentDialog, DialogPanel, TooltipProvider } from '@/ui'
import { AssessmentSetupDialog } from '@/components/assessment/AssessmentSetupDialog'
import { AssignmentEditSplitPattern } from '@/app/__ui/AssignmentEditSplitPattern'
import { TestEditSplitPattern } from '@/app/__ui/TestEditSplitPattern'
import { SurveyEditSplitPattern } from '@/app/__ui/SurveyEditSplitPattern'
import { AssignmentCreationPattern } from '@/app/__ui/AssignmentCreationPattern'
import { ModalClosePattern } from '@/app/__ui/ModalClosePattern'

describe('DialogCloseButton shared modal contract', () => {
  it('gives AssessmentSetupDialog the shared disabled cancellation control', () => {
    const onClose = vi.fn()
    render(<AssessmentSetupDialog isOpen title="Test setup" titleId="setup" closeLabel="Close setup" onClose={onClose} closeDisabled>Fields</AssessmentSetupDialog>)
    const close = screen.getByRole('button', { name: 'Close setup' })
    expect(close).toBeDisabled()
    expect(close.closest('[data-dialog-close]')).toHaveClass('right-3', 'top-3')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
  it.each([
    [AssignmentCreationPattern, 'Open assignment example', 'New Assignment', 'Close assignment example'],
    [AssignmentEditSplitPattern, 'Open assignment edit prototype', 'Edit Assignment', 'Close assignment edit prototype'],
    [TestEditSplitPattern, 'Open test edit prototype', 'Edit Test', 'Close test edit prototype'],
    [SurveyEditSplitPattern, 'Open survey edit prototype', 'Edit Survey', 'Close survey edit prototype'],
  ] as const)('gives %s one modal-owned corner close', (Pattern, opener, title, label) => {
    render(<TooltipProvider><Pattern /></TooltipProvider>)
    fireEvent.click(screen.getByRole('button', { name: opener }))
    const dialog = screen.getByRole('dialog', { name: title })
    const close = within(dialog).getByRole('button', { name: label })
    const heading = within(dialog).getByRole('heading', { name: title })
    expect(heading.parentElement).toBe(dialog)
    expect(heading.nextElementSibling).toContainElement(within(dialog).getByRole('textbox', { name: 'Title' }))
    expect(dialog.querySelectorAll('[data-dialog-close]')).toHaveLength(1)
    expect(close.closest('[data-dialog-close]')).toHaveClass('right-3', 'top-3')
    expect(dialog.querySelector('[data-testid$="editor-details-pane"]')).not.toContainElement(close)
    fireEvent.click(close)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps ModalClosePattern examples closed until a user opens one', () => {
    render(<ModalClosePattern />)
    expect(screen.getAllByRole('button', { name: /Open .* close example/ })).toHaveLength(5)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it.each(['alert', 'confirm', 'content', 'panel'] as const)('provides one corner X for %s', (kind) => {
    const close = vi.fn()
    render(kind === 'alert' ? <AlertDialog isOpen title="Example" onClose={close} />
      : kind === 'confirm' ? <ConfirmDialog isOpen title="Example" onCancel={close} onConfirm={vi.fn()} />
      : kind === 'content' ? <ContentDialog isOpen title="Example" onClose={close} showFooterClose={false}>Content</ContentDialog>
      : <DialogPanel isOpen onClose={close} ariaLabelledBy="example-title"><h2 id="example-title">Example</h2></DialogPanel>)
    const dialog = screen.getByRole(kind === 'alert' ? 'alertdialog' : 'dialog')
    const button = within(dialog).getByRole('button', { name: 'Close', exact: true })
    expect(dialog.querySelectorAll('[data-dialog-close]')).toHaveLength(1)
    expect(button.closest('[data-dialog-close]')).toHaveClass('absolute', 'right-3', 'top-3')
    fireEvent.click(button)
    expect(close).toHaveBeenCalledOnce()
  })

  it('uses cancellation for the X and preserves disabled cancellation for every close route', () => {
    const onCancel = vi.fn(), onConfirm = vi.fn()
    const view = render(<ConfirmDialog isOpen title="Delete?" onCancel={onCancel} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
    onCancel.mockClear()
    view.rerender(<ConfirmDialog isOpen title="Delete?" onCancel={onCancel} onConfirm={onConfirm} isCancelDisabled />)
    expect(screen.getByRole('button', { name: 'Close', exact: true })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('guards the custom panel close and leaves its content mounted while busy', () => {
    const close = vi.fn()
    render(<DialogPanel isOpen onClose={close} closeDisabled closeLabel="Close upload">
      <h2>Upload</h2><p>Keep uploading</p>
    </DialogPanel>)
    expect(screen.getByRole('button', { name: 'Close upload' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Close upload' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByText('Keep uploading')).toBeInTheDocument()
  })
})
