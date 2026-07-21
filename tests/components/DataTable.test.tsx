import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  DataTable,
  DataTableHead,
  KeyboardNavigableTable,
  SortableHeaderCell,
  TableCard,
} from '@/ui'

describe('TableCard', () => {
  it('renders default chrome for standard tables', () => {
    const { container } = render(
      <TableCard>
        <div>Rows</div>
      </TableCard>,
    )

    expect(screen.getByText('Rows')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('rounded-lg', 'border', 'border-border', 'bg-surface')
  })

  it('renders flush chrome when table lives inside an outer shell', () => {
    const { container } = render(
      <TableCard chrome="flush">
        <div>Rows</div>
      </TableCard>,
    )

    expect(screen.getByText('Rows')).toBeInTheDocument()
    expect(container.firstChild).not.toHaveClass('rounded-lg')
    expect(container.firstChild).not.toHaveClass('border')
    expect(container.firstChild).not.toHaveClass('bg-surface')
    expect(container.firstChild).toHaveClass('overflow-hidden')
  })

  it('gives sortable headers a visible focus treatment and accessible target', () => {
    render(
      <DataTable>
        <DataTableHead>
          <tr>
            <SortableHeaderCell
              label="Last name"
              isActive
              direction="asc"
              onClick={vi.fn()}
            />
          </tr>
        </DataTableHead>
      </DataTable>,
    )

    expect(screen.getByRole('button', { name: 'Last name' })).toHaveClass(
      'min-h-11',
      'focus-visible:ring-2',
      'focus-visible:ring-inset',
    )
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending')
  })

  it('keeps keyboard table navigation focus visible', async () => {
    const onSelectKey = vi.fn()
    const renderTable = (selectedKey: 'student-1' | 'student-2' | null) => (
      <KeyboardNavigableTable
        ariaLabel="Students"
        rowKeys={['student-1', 'student-2']}
        selectedKey={selectedKey}
        onSelectKey={onSelectKey}
        getRowId={(key) => `student-row-${key}`}
      >
        <div id="student-row-student-1" tabIndex={-1}>Student one</div>
        <div id="student-row-student-2" tabIndex={-1}>Student two</div>
      </KeyboardNavigableTable>
    )
    const { rerender } = render(renderTable(null))

    const tableNavigation = screen.getByRole('region', { name: 'Students' })
    expect(tableNavigation).toHaveAttribute('tabindex', '0')
    expect(tableNavigation).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-primary')

    fireEvent.keyDown(tableNavigation, { key: 'ArrowDown' })
    expect(onSelectKey).toHaveBeenCalledWith('student-1')
    rerender(renderTable('student-1'))
    await waitFor(() => {
      expect(screen.getByText('Student one')).toHaveFocus()
    })

    fireEvent.keyDown(tableNavigation, { key: 'End' })
    expect(onSelectKey).toHaveBeenCalledWith('student-2')

    rerender(renderTable('student-2'))

    expect(tableNavigation).toHaveAttribute(
      'aria-keyshortcuts',
      'ArrowUp ArrowDown Home End Escape',
    )
  })

  it('preserves the legacy aria-label prop', () => {
    render(
      <KeyboardNavigableTable
        aria-label="Legacy students"
        rowKeys={[]}
        selectedKey={null}
        onSelectKey={vi.fn()}
      >
        <div>Rows</div>
      </KeyboardNavigableTable>,
    )

    expect(screen.getByRole('region', { name: 'Legacy students' })).toBeInTheDocument()
  })

  it('cancels queued row focus when Escape clears keyboard selection', () => {
    vi.useFakeTimers()
    const onDeselect = vi.fn()

    try {
      render(
        <KeyboardNavigableTable
          ariaLabel="Students"
          rowKeys={['student-1']}
          selectedKey={null}
          onSelectKey={vi.fn()}
          onDeselect={onDeselect}
          getRowId={(key) => `student-row-${key}`}
        >
          <div id="student-row-student-1" tabIndex={-1}>Student one</div>
        </KeyboardNavigableTable>,
      )

      const tableNavigation = screen.getByRole('region', { name: 'Students' })
      tableNavigation.focus()
      fireEvent.keyDown(tableNavigation, { key: 'ArrowDown' })
      fireEvent.keyDown(tableNavigation, { key: 'Escape' })
      vi.runAllTimers()

      expect(onDeselect).toHaveBeenCalledOnce()
      expect(tableNavigation).toHaveFocus()
      expect(screen.getByText('Student one')).not.toHaveFocus()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not intercept table shortcuts from interactive row controls', () => {
    const onSelectKey = vi.fn()
    const onDeselect = vi.fn()

    render(
      <KeyboardNavigableTable
        ariaLabel="Students"
        rowKeys={['student-1']}
        selectedKey="student-1"
        onSelectKey={onSelectKey}
        onDeselect={onDeselect}
      >
        <div>
          <input aria-label="Counselor email" />
        </div>
      </KeyboardNavigableTable>,
    )

    const emailInput = screen.getByRole('textbox', { name: 'Counselor email' })
    expect(fireEvent.keyDown(emailInput, { key: 'ArrowDown' })).toBe(true)
    expect(fireEvent.keyDown(emailInput, { key: 'Home' })).toBe(true)
    expect(fireEvent.keyDown(emailInput, { key: 'Escape' })).toBe(true)
    expect(onSelectKey).not.toHaveBeenCalled()
    expect(onDeselect).not.toHaveBeenCalled()
  })
})
