import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  ColumnResizeHandle,
  DataTable,
  DataTableHead,
  KeyboardNavigableTable,
  SortableHeaderCell,
  TableSelectionCheckbox,
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
      'min-h-control',
      'focus-visible:ring-foundation',
      'focus-visible:ring-inset',
    )
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending')
  })

  it('provides shared separator semantics and keyboard resizing for sortable columns', () => {
    const onSort = vi.fn()

    function ResizableTable() {
      const [width, setWidth] = useState(72)
      return (
        <DataTable className="table-fixed">
          <DataTableHead>
            <tr>
              <SortableHeaderCell
                label="First"
                isActive={false}
                direction="asc"
                onClick={onSort}
                resize={{ value: width, min: 60, max: 160, onChange: setWidth }}
              />
            </tr>
          </DataTableHead>
        </DataTable>
      )
    }

    render(<ResizableTable />)

    const separator = screen.getByRole('separator', { name: 'Resize First column' })
    expect(separator).toHaveAttribute('aria-orientation', 'vertical')
    expect(separator).toHaveAttribute('aria-valuemin', '60')
    expect(separator).toHaveAttribute('aria-valuemax', '160')
    expect(separator).toHaveAttribute('aria-valuenow', '72')
    expect(separator).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Home End')

    fireEvent.keyDown(separator, { key: 'Home' })
    expect(separator).toHaveAttribute('aria-valuenow', '60')
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(separator).toHaveAttribute('aria-valuenow', '68')
    fireEvent.keyDown(separator, { key: 'End' })
    expect(separator).toHaveAttribute('aria-valuenow', '160')
    expect(onSort).not.toHaveBeenCalled()
  })

  it('supports left-edge pointer resizing and accelerated keyboard resizing', () => {
    function LeftEdgeResize() {
      const [width, setWidth] = useState(96)
      return (
        <div className="group relative">
          <ColumnResizeHandle
            label="Final"
            value={width}
            min={80}
            max={220}
            step={8}
            edge="left"
            onChange={setWidth}
          />
        </div>
      )
    }

    render(<LeftEdgeResize />)

    const separator = screen.getByRole('separator', { name: 'Resize Final column' })
    fireEvent(separator, new MouseEvent('pointerdown', { bubbles: true, clientX: 100 }))
    fireEvent(window, new MouseEvent('pointermove', { bubbles: true, clientX: 80 }))
    expect(separator).toHaveAttribute('aria-valuenow', '116')
    fireEvent(window, new MouseEvent('pointerup', { bubbles: true }))

    fireEvent.keyDown(separator, { key: 'ArrowRight', shiftKey: true })
    expect(separator).toHaveAttribute('aria-valuenow', '140')
  })

  it('provides an indeterminate table checkbox without triggering row activation', () => {
    const onChange = vi.fn()
    const onRowClick = vi.fn()

    render(
      <div onClick={onRowClick}>
        <TableSelectionCheckbox
          checked={false}
          indeterminate
          onChange={onChange}
          ariaLabel="Select all visible students"
        />
      </div>,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Select all visible students' })
    expect(checkbox).toHaveProperty('indeterminate', true)
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed')

    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledOnce()
    expect(onRowClick).not.toHaveBeenCalled()
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
    expect(tableNavigation).toHaveClass(
      'focus-visible:ring-foundation',
      'focus-visible:ring-focus',
    )

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
