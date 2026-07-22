import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
    expect(edit).toHaveClass('min-h-11', 'min-w-11', 'focus-visible:ring-2')

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
})
