import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AlertDialog, ConfirmDialog, ContentDialog } from '@/ui'

describe('AlertDialog', () => {
  const defaultProps = {
    isOpen: true,
    title: 'Alert Title',
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.useFakeTimers()
    defaultProps.onClose = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders when open', () => {
    render(<AlertDialog {...defaultProps} />)
    expect(screen.getByText('Alert Title')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<AlertDialog {...defaultProps} isOpen={false} />)
    expect(screen.queryByText('Alert Title')).not.toBeInTheDocument()
  })

  it('shows description', () => {
    render(<AlertDialog {...defaultProps} description="Some details" />)
    expect(screen.getByText('Some details')).toBeInTheDocument()
  })

  it('uses custom button label', () => {
    render(<AlertDialog {...defaultProps} buttonLabel="Got it" />)
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument()
  })

  it('calls onClose on button click', () => {
    render(<AlertDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(defaultProps.onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose on Escape', () => {
    render(<AlertDialog {...defaultProps} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(defaultProps.onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose on Enter', () => {
    render(<AlertDialog {...defaultProps} />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(defaultProps.onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose on backdrop click', () => {
    render(<AlertDialog {...defaultProps} />)
    fireEvent.click(screen.getByLabelText('Close dialog'))
    expect(defaultProps.onClose).toHaveBeenCalledOnce()
  })

  it('auto-dismisses after timeout', () => {
    render(<AlertDialog {...defaultProps} autoDismiss />)
    expect(defaultProps.onClose).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(defaultProps.onClose).toHaveBeenCalledOnce()
  })

  it('shows success icon for success variant', () => {
    render(<AlertDialog {...defaultProps} variant="success" />)
    expect(screen.getByRole('alertdialog').querySelector('.text-success')).toBeInTheDocument()
  })

  it('shows error icon for error variant', () => {
    render(<AlertDialog {...defaultProps} variant="error" />)
    expect(screen.getByRole('alertdialog').querySelector('.text-danger')).toBeInTheDocument()
  })

  it('has alertdialog role with proper aria', () => {
    render(<AlertDialog {...defaultProps} description="desc" />)
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby')
    expect(dialog).toHaveAttribute('aria-describedby')
  })
})

describe('ConfirmDialog', () => {
  const defaultProps = {
    isOpen: true,
    title: 'Confirm Title',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    defaultProps.onConfirm = vi.fn()
    defaultProps.onCancel = vi.fn()
  })

  it('renders when open', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByText('Confirm Title')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<ConfirmDialog {...defaultProps} isOpen={false} />)
    expect(screen.queryByText('Confirm Title')).not.toBeInTheDocument()
  })

  it('shows description', () => {
    render(<ConfirmDialog {...defaultProps} description="Are you sure?" />)
    expect(screen.getByText('Are you sure?')).toBeInTheDocument()
  })

  it('calls onConfirm on confirm click', () => {
    render(<ConfirmDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(defaultProps.onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel on cancel click', () => {
    render(<ConfirmDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(defaultProps.onCancel).toHaveBeenCalledOnce()
  })

  it('calls onCancel on Escape', () => {
    render(<ConfirmDialog {...defaultProps} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(defaultProps.onCancel).toHaveBeenCalledOnce()
  })

  it('calls onCancel on backdrop click', () => {
    render(<ConfirmDialog {...defaultProps} />)
    fireEvent.click(screen.getByLabelText('Close dialog'))
    expect(defaultProps.onCancel).toHaveBeenCalledOnce()
  })

  it('uses custom labels', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel="Delete" cancelLabel="Keep" />)
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument()
  })

  it('disables cancel when isCancelDisabled', () => {
    render(<ConfirmDialog {...defaultProps} isCancelDisabled />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    // Escape should not call onCancel
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(defaultProps.onCancel).not.toHaveBeenCalled()
  })

  it('disables confirm when isConfirmDisabled', () => {
    render(<ConfirmDialog {...defaultProps} isConfirmDisabled />)
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  })

  it('has dialog role with proper aria', () => {
    render(<ConfirmDialog {...defaultProps} description="desc" />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby')
    expect(dialog).toHaveAttribute('aria-describedby')
  })
})

describe('ContentDialog', () => {
  const defaultProps = {
    isOpen: true,
    title: 'Content Title',
    onClose: vi.fn(),
    children: <p>Dialog body</p>,
  }

  beforeEach(() => {
    defaultProps.onClose = vi.fn()
  })

  it('renders when open', () => {
    render(<ContentDialog {...defaultProps} />)
    expect(screen.getByText('Content Title')).toBeInTheDocument()
    expect(screen.getByText('Dialog body')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<ContentDialog {...defaultProps} isOpen={false} />)
    expect(screen.queryByText('Content Title')).not.toBeInTheDocument()
  })

  it('shows subtitle', () => {
    render(<ContentDialog {...defaultProps} subtitle="Sub" />)
    expect(screen.getByText('Sub')).toBeInTheDocument()
  })

  it('calls onClose on Escape', () => {
    render(<ContentDialog {...defaultProps} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(defaultProps.onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose on backdrop click', () => {
    render(<ContentDialog {...defaultProps} />)
    fireEvent.click(screen.getByLabelText('Close dialog'))
    expect(defaultProps.onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose on X button click', () => {
    render(<ContentDialog {...defaultProps} />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(defaultProps.onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose on Close footer button click', () => {
    render(<ContentDialog {...defaultProps} />)
    const closeButtons = screen.getAllByRole('button', { name: 'Close' })
    const footerButton = closeButtons.find((btn) => btn.textContent === 'Close')!
    fireEvent.click(footerButton)
    expect(defaultProps.onClose).toHaveBeenCalledOnce()
  })

  it('has dialog role with proper aria', () => {
    render(<ContentDialog {...defaultProps} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby')
  })

  it('has viewport constraint classes for overflow prevention', () => {
    render(<ContentDialog {...defaultProps} />)
    const dialog = screen.getByRole('dialog')
    // Verify max-height and max-width viewport constraints
    expect(dialog.className).toMatch(/max-h-\[85vh\]/)
    expect(dialog.className).toMatch(/max-w-\[90vw\]/)
    // Verify flex layout for scrollable content
    expect(dialog.className).toContain('flex')
    expect(dialog.className).toContain('flex-col')
  })

  it('has scrollable content area with non-shrinking footer', () => {
    render(
      <ContentDialog {...defaultProps}>
        <div data-testid="content">Long content here</div>
      </ContentDialog>
    )
    // Find content wrapper (parent of our test content)
    const content = screen.getByTestId('content')
    const contentWrapper = content.parentElement!
    expect(contentWrapper.className).toContain('overflow-y-auto')
    expect(contentWrapper.className).toContain('min-h-0')
    expect(contentWrapper.className).toContain('flex-1')

    // Find footer (contains Close button text)
    const closeButtons = screen.getAllByRole('button', { name: 'Close' })
    const footerButton = closeButtons.find((btn) => btn.textContent === 'Close')!
    const footer = footerButton.parentElement!
    expect(footer.className).toContain('flex-shrink-0')
  })
})
