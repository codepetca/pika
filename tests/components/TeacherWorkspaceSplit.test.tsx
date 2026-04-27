import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TeacherWorkspaceSplit } from '@/components/teacher-work-surface/TeacherWorkspaceSplit'

describe('TeacherWorkspaceSplit', () => {
  it('renders primary and inspector panes with a resize handle when expanded', () => {
    render(
      <TeacherWorkspaceSplit
        primary={<div>Student table</div>}
        inspector={<div>Inspector pane</div>}
        inspectorWidth={42}
        inspectorCollapsed={false}
        onInspectorWidthChange={vi.fn()}
        dividerLabel="Resize table and grading panes"
      />,
    )

    expect(screen.getByText('Student table')).toBeInTheDocument()
    expect(screen.getByText('Inspector pane')).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Resize table and grading panes' })).toBeInTheDocument()
  })

  it('hides the inspector and divider while preserving the primary pane when collapsed', () => {
    render(
      <TeacherWorkspaceSplit
        primary={<div>Student table</div>}
        inspector={<div>Inspector pane</div>}
        inspectorWidth={42}
        inspectorCollapsed
        onInspectorWidthChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Student table')).toBeInTheDocument()
    expect(screen.queryByText('Inspector pane')).not.toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })

  it('reports clamped inspector width changes from the structural resize handle', () => {
    const onInspectorWidthChange = vi.fn()
    const onInspectorCollapsedChange = vi.fn()

    render(
      <TeacherWorkspaceSplit
        primary={<div>Student table</div>}
        inspector={<div>Inspector pane</div>}
        inspectorWidth={50}
        inspectorCollapsed={false}
        onInspectorWidthChange={onInspectorWidthChange}
        onInspectorCollapsedChange={onInspectorCollapsedChange}
        dividerLabel="Resize panes"
      />,
    )

    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(screen.getByRole('separator', { name: 'Resize panes' }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 700 }))
    window.dispatchEvent(new MouseEvent('pointerup'))

    expect(onInspectorCollapsedChange).toHaveBeenCalledWith(false)
    expect(onInspectorWidthChange).toHaveBeenCalledWith(32)
    rectSpy.mockRestore()
  })

  it('honors configured primary and inspector width bounds', () => {
    const onInspectorWidthChange = vi.fn()

    render(
      <TeacherWorkspaceSplit
        primary={<div>Student table</div>}
        inspector={<div>Inspector pane</div>}
        inspectorWidth={50}
        inspectorCollapsed={false}
        minInspectorPx={320}
        minPrimaryPx={420}
        onInspectorWidthChange={onInspectorWidthChange}
        dividerLabel="Resize panes"
      />,
    )

    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(screen.getByRole('separator', { name: 'Resize panes' }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 950 }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100 }))
    window.dispatchEvent(new MouseEvent('pointerup'))

    expect(onInspectorWidthChange).toHaveBeenNthCalledWith(1, 32)
    expect(onInspectorWidthChange).toHaveBeenNthCalledWith(2, 58)
    rectSpy.mockRestore()
  })
})
