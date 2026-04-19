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
          onDoubleClick,
        }}
      />,
    )

    expect(screen.getByText('Left pane')).toBeInTheDocument()
    expect(screen.getByText('Right pane')).toBeInTheDocument()

    const separator = screen.getByRole('separator', { name: 'Resize panes' })
    fireEvent.pointerDown(separator)
    fireEvent.doubleClick(separator)

    expect(onPointerDown).toHaveBeenCalledTimes(1)
    expect(onDoubleClick).toHaveBeenCalledTimes(1)
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
