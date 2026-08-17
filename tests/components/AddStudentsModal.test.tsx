import { startTransition, Suspense, useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddStudentsModal } from '@/components/AddStudentsModal'

describe('AddStudentsModal', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the shared static table structure for parsed roster previews', () => {
    render(
      <AddStudentsModal
        isOpen
        onClose={vi.fn()}
        classroomId="classroom-1"
        onSuccess={vi.fn()}
      />,
    )

    const rosterInput = screen.getByLabelText('Enter student information')
    fireEvent.change(rosterInput, {
      target: { value: 'Ada Lovelace ada@example.com 1001 counselor@example.com' },
    })
    fireEvent.blur(rosterInput)

    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'First Name' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Counselor' })).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /Ada Lovelace ada@example\.com 1001 counselor@example\.com/ }))
      .toBeInTheDocument()
    expect(within(table).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(table).queryByRole('separator')).not.toBeInTheDocument()
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
    const view = render(
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

    render(<Harness />)
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
    const view = render(modal(true))

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
