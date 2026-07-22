import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WorkspaceSplitPane } from '@/components/WorkspaceSplitPane'

describe('WorkspaceSplitPane', () => {
  it('renders both panes and exposes the optional divider', () => {
    const onPointerDown = vi.fn()
    const onDoubleClick = vi.fn()

    render(
      <WorkspaceSplitPane
        left={<div>Left pane</div>}
        right={<div>Right pane</div>}
        divider={{
          label: 'Resize panes',
          onPointerDown,
          onKeyDown: vi.fn(),
          onDoubleClick,
          ariaValueMin: 20,
          ariaValueMax: 80,
          ariaValueNow: 50,
        }}
      />,
    )

    expect(screen.getByText('Left pane')).toBeInTheDocument()
    expect(screen.getByText('Right pane')).toBeInTheDocument()

    const separator = screen.getByRole('separator', { name: 'Resize panes' })
    expect(separator).toHaveClass('w-11', 'focus-visible:ring-2', 'focus-visible:ring-primary')
    fireEvent.pointerDown(separator)
    fireEvent.doubleClick(separator)

    expect(onPointerDown).toHaveBeenCalledTimes(1)
    expect(onDoubleClick).toHaveBeenCalledTimes(1)
  })

  it('makes a keyboard-controlled divider focusable and reports its value', () => {
    const onKeyDown = vi.fn()
    render(
      <WorkspaceSplitPane
        left={<div>Left pane</div>}
        right={<div>Right pane</div>}
        divider={{
          label: 'Resize panes',
          onPointerDown: vi.fn(),
          onKeyDown,
          ariaValueMin: 20,
          ariaValueMax: 80,
          ariaValueNow: 45,
        }}
      />,
    )

    const separator = screen.getByRole('separator', { name: 'Resize panes' })
    expect(separator).toHaveAttribute('tabindex', '0')
    expect(separator).toHaveAttribute('aria-orientation', 'vertical')
    expect(separator).toHaveAttribute('aria-valuemin', '20')
    expect(separator).toHaveAttribute('aria-valuemax', '80')
    expect(separator).toHaveAttribute('aria-valuenow', '45')
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(onKeyDown).toHaveBeenCalledOnce()
  })

  it('omits the right pane when rightVisible is false', () => {
    render(
      <WorkspaceSplitPane
        left={<div>Left only</div>}
        right={<div>Hidden right</div>}
        rightVisible={false}
      />,
    )

    expect(screen.getByText('Left only')).toBeInTheDocument()
    expect(screen.queryByText('Hidden right')).not.toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })
})
