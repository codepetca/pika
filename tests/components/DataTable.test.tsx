import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  DataTable,
  DataTableHead,
  KeyboardNavigableTable,
  SortableHeaderCell,
  TableCard,
} from '@/components/DataTable'

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

  it('keeps keyboard table navigation focus visible', () => {
    const onSelectKey = vi.fn()
    render(
      <KeyboardNavigableTable
        rowKeys={['student-1', 'student-2']}
        selectedKey={null}
        onSelectKey={onSelectKey}
        aria-label="Students"
      >
        <div>Rows</div>
      </KeyboardNavigableTable>,
    )

    const tableNavigation = screen.getByLabelText('Students')
    expect(tableNavigation).toHaveAttribute('tabindex', '0')
    expect(tableNavigation).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-primary')

    fireEvent.keyDown(tableNavigation, { key: 'ArrowDown' })
    expect(onSelectKey).toHaveBeenCalledWith('student-1')
  })
})
