import { startTransition, Suspense, useState, type ReactElement } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddStudentsModal } from '@/components/AddStudentsModal'
import { TooltipProvider } from '@/ui'

function renderWithTooltips(ui: ReactElement) {
  return render(ui, { wrapper: TooltipProvider })
}

describe('AddStudentsModal', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows roster format help and enables adding without a preview step', async () => {
    renderWithTooltips(
      <AddStudentsModal
        isOpen
        onClose={vi.fn()}
        classroomId="classroom-1"
        onSuccess={vi.fn()}
      />,
    )

    const rosterInput = screen.getByLabelText('Enter student information')
    const helpButton = screen.getByRole('button', { name: 'Roster format help' })
    expect(rosterInput).toHaveAttribute(
      'placeholder',
      'Jane Doe jane@example.com [123456] [guardian@example.com]',
    )
    expect(rosterInput).toHaveAttribute('rows', '12')
    expect(helpButton).toBeInTheDocument()
    expect(screen.queryByText(/student number and guardian email are optional/i)).not.toBeInTheDocument()
    fireEvent.focus(helpButton)
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('One student per line.')
    expect(tooltip).toHaveTextContent('[First name] [Last name] [Email] [ID] [Guardian email]')
    expect(tooltip).toHaveTextContent('ID and guardian email are optional')
    const formatLine = tooltip.querySelector('.font-semibold') as HTMLElement
    expect(formatLine).toHaveClass('font-semibold')
    expect(formatLine).toHaveTextContent('[First name] [Last name] [Email] [ID] [Guardian email]')
    expect(formatLine.querySelectorAll('em')).toHaveLength(2)
    expect(formatLine.querySelector('em')).toHaveTextContent('ID')
    expect(formatLine.querySelectorAll('em')[1]).toHaveTextContent('Guardian email')
    fireEvent.change(rosterInput, {
      target: { value: 'Ada Lovelace ada@example.com 1001 counselor@example.com' },
    })

    expect(screen.queryByText(/student ready to add/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show Preview' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 1 Student' })).toBeEnabled()
  })

  it('shows helpful roster guidance while typing without opening the preview', () => {
    renderWithTooltips(
      <AddStudentsModal
        isOpen
        onClose={vi.fn()}
        classroomId="classroom-1"
        onSuccess={vi.fn()}
      />,
    )

    const rosterInput = screen.getByLabelText('Enter student information')
    fireEvent.change(rosterInput, { target: { value: 'Ada Lovelace not-an-email' } })

    const warning = screen.getByRole('status')
    expect(rosterInput).toHaveAttribute('aria-invalid', 'true')
    expect(rosterInput).toHaveAccessibleDescription('Line 1: Invalid email format')
    expect(warning).toHaveTextContent('Line 1: Invalid email format')
    expect(warning).not.toHaveTextContent('Some lines need attention before they can be added.')
    expect(screen.queryByText('Line 1: Ada Lovelace not-an-email')).not.toBeInTheDocument()
    const highlightedLine = document.querySelector('[aria-hidden="true"] .bg-warning-bg')
    expect(highlightedLine).toHaveTextContent('Ada Lovelace not-an-email')
    expect(highlightedLine).toHaveClass('text-warning')
    expect(screen.queryByRole('button', { name: 'Show Preview' })).not.toBeInTheDocument()

    fireEvent.change(rosterInput, { target: { value: 'Ada Lovelace ada@example.com' } })
    expect(rosterInput).toHaveAttribute('aria-invalid', 'false')
    expect(rosterInput).not.toHaveAttribute('aria-describedby')

    expect(screen.queryByText('Some lines need attention before they can be added.')).not.toBeInTheDocument()
    expect(screen.queryByText(/student ready to add/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 1 Student' })).toBeEnabled()
  })

  it('identifies invalid lines and submits only valid rows without discarding the entered text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, upsertedCount: 1 }) })
    vi.stubGlobal('fetch', fetchMock)
    renderWithTooltips(<AddStudentsModal isOpen onClose={vi.fn()} classroomId="classroom-1" onSuccess={vi.fn()} />)
    const input = screen.getByLabelText('Enter student information')
    const value = 'Ada Lovelace ada@example.com\n\nJane Doe jane@example.com 123 guardian@bad'
    fireEvent.change(input, { target: { value } })
    expect(input).toHaveValue(value)
    expect(input).toHaveAccessibleDescription('Line 3: Invalid guardian email format Only valid rows will be added.')
    expect(screen.getByRole('status')).not.toHaveTextContent('guardian@bad')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add 1 Student' })) })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).students).toEqual([
      { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    ])
    expect(input).toHaveValue('Jane Doe jane@example.com 123 guardian@bad')
    expect(screen.getByText('Valid students added. Correct the remaining lines.')).toBeInTheDocument()
  })

  it('uses a named modal and restores focus when dismissed', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return <><button onClick={() => setOpen(true)}>Open roster</button><AddStudentsModal isOpen={open} onClose={() => setOpen(false)} classroomId="classroom-1" onSuccess={vi.fn()} /></>
    }
    renderWithTooltips(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open roster' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Add Students' })
    expect(dialog).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => {})
    expect(opener).toHaveFocus()
  })

  it('allows backdrop and close button dismissal and guards all dismissal while adding', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const onClose = vi.fn()
    renderWithTooltips(<AddStudentsModal isOpen onClose={onClose} classroomId="classroom-1" onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close Add Students' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.change(screen.getByLabelText('Enter student information'), { target: { value: 'Ada Lovelace ada@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 Student' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close Add Students' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps input and warns when a response does not confirm every submitted row', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, upsertedCount: 0, errors: [{ error: 'Rejected' }] }) }))
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    renderWithTooltips(<AddStudentsModal isOpen onClose={onClose} classroomId="classroom-1" onSuccess={onSuccess} />)
    const input = screen.getByLabelText('Enter student information')
    const value = 'Ada Lovelace ada@example.com'
    fireEvent.change(input, { target: { value } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add 1 Student' })) })
    expect(input).toHaveValue(value)
    expect(screen.getByRole('alert')).toHaveTextContent('Some students may have been added. Check the roster before retrying.')
    expect(onSuccess).toHaveBeenCalledWith('classroom-1')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not offer confirmed rows for resubmission when the roster refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, upsertedCount: 1 }) }))
    const onClose = vi.fn()
    renderWithTooltips(<AddStudentsModal isOpen onClose={onClose} classroomId="classroom-1" onSuccess={vi.fn().mockRejectedValue(new Error('Refresh failed'))} />)
    const input = screen.getByLabelText('Enter student information')
    fireEvent.change(input, { target: { value: 'Ada Lovelace ada@example.com\nJane Doe jane@example.com 123 guardian@bad' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add 1 Student' })) })
    expect(input).toHaveValue('Jane Doe jane@example.com 123 guardian@bad')
    expect(screen.getByRole('alert')).toHaveTextContent('Students were added, but the roster could not be refreshed.')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('submits a guardian email when the manual entry omits a student number', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, upsertedCount: 1 }) })
    vi.stubGlobal('fetch', fetchMock)
    renderWithTooltips(
      <AddStudentsModal
        isOpen
        onClose={vi.fn()}
        classroomId="classroom-1"
        onSuccess={vi.fn()}
      />,
    )

    const rosterInput = screen.getByLabelText('Enter student information')
    fireEvent.change(rosterInput, {
      target: { value: 'Grace Hopper grace@example.com secondary@example.com' },
    })
    fireEvent.blur(rosterInput)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add 1 Student' })) })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      students: [{ firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com', counselorEmail: 'secondary@example.com' }],
    })
  })

  it('does not let a stale classroom response close or repaint a newly opened modal', async () => {
    let resolveAdd: (() => void) | null = null
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
      resolveAdd = () => resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, upsertedCount: 1 }),
      })
    })))
    const onCloseA = vi.fn()
    const onCloseB = vi.fn()
    const onSuccess = vi.fn()
    const view = renderWithTooltips(
      <AddStudentsModal
        isOpen
        onClose={onCloseA}
        classroomId="classroom-a"
        onSuccess={onSuccess}
      />,
    )

    const rosterInput = screen.getByLabelText('Enter student information')
    fireEvent.change(rosterInput, {
      target: { value: 'Ada Lovelace ada@example.com' },
    })
    fireEvent.blur(rosterInput)
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 Student' }))
    expect(await screen.findByRole('button', { name: 'Adding...' })).toBeDisabled()
    const close = screen.getByRole('button', { name: 'Close Add Students' })
    expect(close).toBeDisabled()
    fireEvent.click(close)
    expect(onCloseA).not.toHaveBeenCalled()

    view.rerender(
      <AddStudentsModal
        isOpen
        onClose={onCloseB}
        classroomId="classroom-b"
        onSuccess={onSuccess}
      />,
    )
    expect(screen.getByLabelText('Enter student information')).toHaveValue('')

    await act(async () => {
      resolveAdd?.()
    })

    expect(onSuccess).toHaveBeenCalledWith('classroom-a')
    expect(onCloseA).not.toHaveBeenCalled()
    expect(onCloseB).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Add Students' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 0 Students' })).toBeDisabled()
  })

  it.each([
    { outcome: 'success', ok: true },
    { outcome: 'failure', ok: false },
  ])('keeps the committed classroom active after an abandoned transition ($outcome)', async ({ ok }) => {
    let resolveAdd: (() => void) | null = null
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
      resolveAdd = () => resolve({
        ok,
        json: () => Promise.resolve(ok ? { success: true, upsertedCount: 1 } : { error: 'Add failed' }),
      })
    })))
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    const suspended = new Promise<never>(() => {})

    function SuspendClassroomB({ classroomId }: { classroomId: string }) {
      if (classroomId === 'classroom-b') throw suspended
      return null
    }

    function Harness() {
      const [classroomId, setClassroomId] = useState('classroom-a')
      return (
        <>
          <button
            type="button"
            onClick={() => startTransition(() => setClassroomId('classroom-b'))}
          >
            Switch classroom
          </button>
          <Suspense fallback={<div>Switching</div>}>
            <AddStudentsModal
              isOpen
              onClose={onClose}
              classroomId={classroomId}
              onSuccess={onSuccess}
            />
            <SuspendClassroomB classroomId={classroomId} />
          </Suspense>
        </>
      )
    }

    renderWithTooltips(<Harness />)
    const rosterInput = screen.getByLabelText('Enter student information')
    fireEvent.change(rosterInput, {
      target: { value: 'Ada Lovelace ada@example.com' },
    })
    fireEvent.blur(rosterInput)
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 Student' }))
    expect(await screen.findByRole('button', { name: 'Adding...' })).toBeDisabled()

    // Simulate a parent transition; the modal correctly makes background controls inert.
    fireEvent.click(screen.getByText('Switch classroom'))
    expect(screen.queryByText('Switching')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Enter student information')).toHaveValue(
      'Ada Lovelace ada@example.com',
    )

    await act(async () => {
      resolveAdd?.()
    })

    if (ok) {
      expect(onSuccess).toHaveBeenCalledWith('classroom-a')
      expect(onClose).toHaveBeenCalledTimes(1)
    } else {
      expect(await screen.findByText('Add failed')).toBeInTheDocument()
      expect(onSuccess).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    }
    expect(screen.getByRole('button', { name: 'Add 1 Student' })).toBeEnabled()
  })

  it.each([
    { lifecycle: 'close and reopen', ok: true },
    { lifecycle: 'close and reopen', ok: false },
    { lifecycle: 'unmount', ok: true },
    { lifecycle: 'unmount', ok: false },
  ])('ignores an in-flight $lifecycle completion (ok: $ok)', async ({ lifecycle, ok }) => {
    let resolveAdd: (() => void) | null = null
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
      resolveAdd = () => resolve({
        ok,
        json: () => Promise.resolve(ok ? { success: true, upsertedCount: 1 } : { error: 'Add failed' }),
      })
    })))
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    const modal = (isOpen: boolean) => (
      <AddStudentsModal
        isOpen={isOpen}
        onClose={onClose}
        classroomId="classroom-a"
        onSuccess={onSuccess}
      />
    )
    const view = renderWithTooltips(modal(true))

    fireEvent.change(screen.getByLabelText('Enter student information'), {
      target: { value: 'Ada Lovelace ada@example.com' },
    })
    fireEvent.blur(screen.getByLabelText('Enter student information'))
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 Student' }))
    expect(await screen.findByRole('button', { name: 'Adding...' })).toBeDisabled()

    if (lifecycle === 'unmount') {
      view.unmount()
    } else {
      view.rerender(modal(false))
      view.rerender(modal(true))
      expect(screen.getByLabelText('Enter student information')).toHaveValue('')
    }

    await act(async () => {
      resolveAdd?.()
    })

    if (ok) {
      expect(onSuccess).toHaveBeenCalledWith('classroom-a')
    } else {
      expect(onSuccess).not.toHaveBeenCalled()
    }
    expect(onClose).not.toHaveBeenCalled()
    if (lifecycle !== 'unmount') {
      expect(screen.queryByText('Add failed')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add 0 Students' })).toBeDisabled()
    }
  })
})
