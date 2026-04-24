import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SummaryDetailWorkspaceShell } from '@/components/SummaryDetailWorkspaceShell'

describe('SummaryDetailWorkspaceShell', () => {
  it('defaults row workspaces to a 50/50 split', () => {
    render(
      <SummaryDetailWorkspaceShell
        orientation="row"
        data-testid="row-shell"
        left={<div>Left pane</div>}
        right={<div>Right pane</div>}
      />,
    )

    expect(screen.getByText('Left pane')).toBeInTheDocument()
    expect(screen.getByText('Right pane')).toBeInTheDocument()

    const root = screen.getByTestId('row-shell')
    const rightPane = root.lastElementChild as HTMLElement | null
    expect(rightPane).toHaveStyle({
      width: '50%',
      flexBasis: '50%',
    })
  })

  it('preserves divider interactions and custom right widths', () => {
    const onPointerDown = vi.fn()
    const onDoubleClick = vi.fn()

    render(
      <SummaryDetailWorkspaceShell
        orientation="responsive"
        data-testid="responsive-shell"
        left={<div>Table pane</div>}
        right={<div>Inspector pane</div>}
        rightWidthPercent={42}
        divider={{
          label: 'Resize panes',
          onPointerDown,
          onDoubleClick,
        }}
      />,
    )

    const separator = screen.getByRole('separator', { name: 'Resize panes' })
    fireEvent.pointerDown(separator)
    fireEvent.doubleClick(separator)

    expect(onPointerDown).toHaveBeenCalledTimes(1)
    expect(onDoubleClick).toHaveBeenCalledTimes(1)
    const root = screen.getByTestId('responsive-shell')
    const rightPane = root.lastElementChild as HTMLElement | null
    expect(rightPane).toHaveStyle({
      width: '42%',
      flexBasis: '42%',
    })
  })
})
