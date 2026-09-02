import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SegmentedControl, TooltipProvider } from '@/ui'

describe('SegmentedControl', () => {
  it('exposes selection and accessible target/focus treatment', () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl
        ariaLabel="Editor mode"
        value="edit"
        options={[
          { value: 'edit', label: 'Edit' },
          { value: 'preview', label: 'Preview' },
        ]}
        onChange={onChange}
      />,
    )

    const group = screen.getByRole('group', { name: 'Editor mode' })
    const edit = screen.getByRole('button', { name: 'Edit' })
    const preview = screen.getByRole('button', { name: 'Preview' })

    expect(group).toContainElement(edit)
    expect(edit).toHaveAttribute('aria-pressed', 'true')
    expect(preview).toHaveAttribute('aria-pressed', 'false')
    expect(edit).toHaveAttribute('tabindex', '0')
    expect(preview).toHaveAttribute('tabindex', '-1')
    expect(edit).toHaveClass(
      'min-h-control',
      'min-w-control',
      'focus-visible:ring-foundation',
    )

    fireEvent.click(preview)
    expect(onChange).toHaveBeenCalledWith('preview')
  })

  it('keeps icon-only options at least 44 by 44 pixels with explicit names', () => {
    render(
      <TooltipProvider>
        <SegmentedControl
          ariaLabel="View"
          value="list"
          iconOnly
          options={[
            { value: 'list', label: 'List view', icon: <span>L</span> },
            { value: 'grid', label: 'Grid view', icon: <span>G</span> },
          ]}
          onChange={vi.fn()}
        />
      </TooltipProvider>,
    )

    expect(screen.getByRole('button', { name: 'List view' })).toHaveClass('h-11', 'w-11')
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveClass('h-11', 'w-11')
  })

  it('supports feature-owned semantic option colors without changing composite behavior', () => {
    render(
      <TooltipProvider>
        <SegmentedControl
          ariaLabel="Attendance status"
          value="present"
          iconOnly
          options={[
            {
              value: 'present',
              label: 'Present',
              className: 'bg-attendance-present text-attendance-present-text',
              activeClassName: 'ring-foundation ring-focus',
              inactiveClassName: 'opacity-40',
            },
            {
              value: 'absent',
              label: 'Absent',
              className: 'bg-attendance-absent text-attendance-absent-text',
              activeClassName: 'ring-foundation ring-focus',
              inactiveClassName: 'opacity-40',
            },
          ]}
          onChange={vi.fn()}
        />
      </TooltipProvider>,
    )

    expect(screen.getByRole('button', { name: 'Present' })).toHaveClass(
      'bg-attendance-present',
      'ring-foundation',
      'ring-focus',
    )
    expect(screen.getByRole('button', { name: 'Absent' })).toHaveClass(
      'bg-attendance-absent',
      'opacity-40',
    )
  })

  it('uses roving arrow, Home, and End navigation while skipping disabled options', () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl
        ariaLabel="View"
        value="list"
        options={[
          { value: 'list', label: 'List' },
          { value: 'board', label: 'Board', disabled: true },
          { value: 'grid', label: 'Grid' },
        ]}
        onChange={onChange}
      />,
    )

    const list = screen.getByRole('button', { name: 'List' })
    const grid = screen.getByRole('button', { name: 'Grid' })

    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('grid')
    expect(grid).toHaveFocus()

    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('list')
    expect(list).toHaveFocus()

    fireEvent.keyDown(list, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('grid')

    fireEvent.keyDown(grid, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('list')
  })

  it('supports option-specific tooltips without changing visible labels', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <SegmentedControl
          ariaLabel="Session end day"
          value="same"
          options={[
            { value: 'same', label: 'Same class day', tooltip: 'Class end on the same day' },
            { value: 'next', label: 'Next day', tooltip: 'Class ends the next day after midnight' },
          ]}
          onChange={vi.fn()}
        />
      </TooltipProvider>,
    )

    const sameDay = screen.getByRole('button', { name: 'Same class day' })
    await user.hover(sameDay)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Class end on the same day')
  })
})
