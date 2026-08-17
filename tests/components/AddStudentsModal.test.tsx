import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AddStudentsModal } from '@/components/AddStudentsModal'

describe('AddStudentsModal', () => {
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
})
