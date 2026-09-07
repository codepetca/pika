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

  it('shows the ready count and roster format help without a preview step', async () => {
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
      'Jane Doe jane@example.com [123456] [jane2@example.com]',
    )
    expect(rosterInput).toHaveAttribute('rows', '12')
    expect(helpButton).toBeInTheDocument()
    expect(screen.queryByText(/student number and secondary email are optional/i)).not.toBeInTheDocument()
    fireEvent.focus(helpButton)
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('One student per line.')
    expect(tooltip).toHaveTextContent('[First name] [Last name] [Email] [ID] [Email 2]')
    expect(tooltip).toHaveTextContent('ID and Email2 are optional')
    const formatLine = tooltip.querySelector('.font-semibold') as HTMLElement
    expect(formatLine).toHaveClass('font-semibold')
    expect(formatLine).toHaveTextContent('[First name] [Last name] [Email] [ID] [Email 2]')
    expect(formatLine.querySelectorAll('em')).toHaveLength(2)
    expect(formatLine.querySelector('em')).toHaveTextContent('ID')
    expect(formatLine.querySelectorAll('em')[1]).toHaveTextContent('Email 2')
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
    expect(warning).toHaveTextContent('Use this format: Jane Doe email@example.com')
    expect(warning).not.toHaveTextContent('Some lines need attention before they can be added.')
    expect(screen.queryByText('Line 1: Ada Lovelace not-an-email')).not.toBeInTheDocument()
    expect(warning).not.toHaveTextContent(/error/i)
    const highlightedLine = document.querySelector('[aria-hidden="true"] .bg-warning-bg')
    expect(highlightedLine).toHaveTextContent('Ada Lovelace not-an-email')
    expect(highlightedLine).toHaveClass('text-warning')
    expect(screen.queryByRole('button', { name: 'Show Preview' })).not.toBeInTheDocument()

    fireEvent.change(rosterInput, { target: { value: 'Ada Lovelace ada@example.com' } })

    expect(screen.queryByText('Some lines need attention before they can be added.')).not.toBeInTheDocument()
    expect(screen.queryByText(/student ready to add/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 1 Student' })).toBeEnabled()
  })

  it('submits a secondary email when the manual entry omits a student number', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
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
        json: () => Promise.resolve({ success: true }),
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
        json: () => Promise.resolve(ok ? { success: true } : { error: 'Add failed' }),
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

    fireEvent.click(screen.getByRole('button', { name: 'Switch classroom' }))
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
        json: () => Promise.resolve(ok ? { success: true } : { error: 'Add failed' }),
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
