import { fireEvent, render, screen, within } from '@testing-library/react'
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
})
