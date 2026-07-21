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
})
