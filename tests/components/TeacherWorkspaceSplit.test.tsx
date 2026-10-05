import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TeacherWorkspaceSplit } from '@/components/teacher-work-surface/TeacherWorkspaceSplit'

// Stacked long-table/inspector sizing is exercised in the experience matrix browser suite.
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
    const separator = screen.getByRole('separator', { name: 'Resize table and grading panes' })
    expect(separator).toBeInTheDocument()
    expect(separator).toHaveAttribute('aria-orientation', 'vertical')
    expect(separator).toHaveAttribute('aria-valuenow', '42')
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

  it('renders the shared gapped split variant for Daily-style panes', () => {
    render(
      <TeacherWorkspaceSplit
        splitVariant="gapped"
        primary={<div>Daily table</div>}
        inspector={<div>Log summary</div>}
        inspectorWidth={50}
        inspectorCollapsed={false}
        onInspectorWidthChange={vi.fn()}
        primaryClassName="rounded-lg bg-surface"
        inspectorClassName="rounded-lg bg-surface"
        minInspectorPercent={28}
        maxInspectorPercent={72}
        dividerLabel="Resize Daily panes"
      />,
    )

    const separator = screen.getByRole('separator', { name: 'Resize Daily panes' })
    const inspectorPane = screen.getByText('Log summary').parentElement
    expect(screen.getByText('Daily table')).toBeInTheDocument()
    expect(screen.getByText('Log summary')).toBeInTheDocument()
    expect(separator).toHaveAttribute('aria-valuemin', '28')
    expect(separator).toHaveAttribute('aria-valuemax', '72')
    expect(inspectorPane).toHaveStyle('--teacher-workspace-inspector-width: calc(50% - 6px)')
  })

  it('keeps mobile inspector reading order ahead of primary while preserving desktop order', () => {
    render(
      <TeacherWorkspaceSplit
        splitVariant="gapped"
        primary={<div>Daily Log</div>}
        mobileInspector={<div>Mobile Today</div>}
        inspector={<div>Desktop Today</div>}
        inspectorWidth={34}
        inspectorCollapsed={false}
        onInspectorWidthChange={vi.fn()}
      />,
    )

    const mobileInspector = screen.getByText('Mobile Today').parentElement
    const primary = screen.getByText('Daily Log')
    const desktopInspector = screen.getByText('Desktop Today').parentElement

    expect(mobileInspector).toHaveClass('lg:hidden')
    expect(desktopInspector).toHaveClass('hidden', 'lg:block')
    expect(mobileInspector?.compareDocumentPosition(primary)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(primary.compareDocumentPosition(desktopInspector!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('keeps an animated inspector mounted but inert when collapsed, preserving its draft', () => {
    const props = {
      splitVariant: 'gapped' as const,
      animateInspector: true,
      primary: <div>Stable table</div>,
      inspector: <input aria-label="Inspector draft" defaultValue="Unsent note" />,
      inspectorWidth: 50,
      onInspectorWidthChange: vi.fn(),
    }
    const view = render(<TeacherWorkspaceSplit {...props} inspectorCollapsed={false} />)
    const primary = screen.getByText('Stable table')
    const draft = screen.getByRole('textbox', { name: 'Inspector draft' })
    fireEvent.change(draft, { target: { value: 'Edited note' } })
    view.rerender(<TeacherWorkspaceSplit {...props} inspectorCollapsed />)
    expect(screen.getByText('Stable table')).toBe(primary)
    expect(draft).toHaveValue('Edited note')
    expect(draft.parentElement).toHaveAttribute('inert')
    expect(draft.parentElement).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    view.rerender(<TeacherWorkspaceSplit {...props} inspectorCollapsed={false} />)
    expect(screen.getByRole('textbox', { name: 'Inspector draft' })).toBe(draft)
    expect(draft.parentElement).not.toHaveAttribute('inert')
  })

  it('supports keyboard resizing for the shared resize handle', () => {
    const onInspectorWidthChange = vi.fn()

    render(
      <TeacherWorkspaceSplit
        primary={<div>Student table</div>}
        inspector={<div>Inspector pane</div>}
        inspectorWidth={50}
        inspectorCollapsed={false}
        onInspectorWidthChange={onInspectorWidthChange}
        minInspectorPercent={28}
        maxInspectorPercent={72}
        dividerLabel="Resize panes"
      />,
    )

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize panes' }), { key: 'ArrowLeft' })
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize panes' }), { key: 'Enter' })

    expect(onInspectorWidthChange).toHaveBeenNthCalledWith(1, 55)
    expect(onInspectorWidthChange).toHaveBeenNthCalledWith(2, 50)
  })

  it('keeps the pane shell and primary identity while its owner immediately clears selected content', () => {
    const props = {
      splitVariant: 'gapped' as const,
      animateInspector: true,
      primary: <input aria-label="Primary draft" defaultValue="Table state" />,
      inspectorWidth: 50,
      inspectorCollapsed: false,
      onInspectorWidthChange: vi.fn(),
    }
    const view = render(<TeacherWorkspaceSplit {...props} inspector={<button>Student A response</button>} />)
    const primary = screen.getByRole('textbox', { name: 'Primary draft' })
    const pane = screen.getByRole('button', { name: 'Student A response' }).parentElement
    fireEvent.change(primary, { target: { value: 'Retained state' } })
    primary.focus()
    view.rerender(<TeacherWorkspaceSplit {...props} inspector={undefined} />)
    expect(view.container.querySelector('[data-workspace-inspector]')).toBe(pane)
    expect(pane).toBeEmptyDOMElement()
    expect(pane).toHaveAttribute('inert')
    expect(pane).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('button', { name: 'Student A response' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Primary draft' })).toBe(primary)
    expect(primary).toHaveValue('Retained state')
    expect(primary).toHaveFocus()
    view.rerender(<TeacherWorkspaceSplit {...props} inspector={<button>Student B response</button>} />)
    expect(view.container.querySelector('[data-workspace-inspector]')).toBe(pane)
    expect(pane).not.toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: 'Student B response' })).toBeInTheDocument()
  })
  it('preserves inspector drafts while the primary presentation is hidden and restored', () => {
    const props = {
      splitVariant: 'gapped' as const,
      animateInspector: true,
      primary: <input aria-label="Primary state" defaultValue="Table state" />,
      inspector: <input aria-label="Inspector state" defaultValue="Initial comment" />,
      inspectorWidth: 50,
      inspectorCollapsed: false,
      onInspectorWidthChange: vi.fn(),
    }
    const view = render(<TeacherWorkspaceSplit {...props} />)
    const primary = screen.getByRole('textbox', { name: 'Primary state' })
    const inspector = screen.getByRole('textbox', { name: 'Inspector state' })
    fireEvent.change(inspector, { target: { value: 'Unsaved comment' } })
    inspector.focus()
    view.rerender(<TeacherWorkspaceSplit {...props} primaryCollapsed />)
    expect(screen.queryByRole('textbox', { name: 'Primary state' })).not.toBeInTheDocument()
    expect(primary.parentElement).toHaveAttribute('inert')
    expect(primary.parentElement).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Inspector state' })).toBe(inspector)
    expect(inspector).toHaveValue('Unsaved comment')
    expect(inspector).toHaveFocus()
    view.rerender(<TeacherWorkspaceSplit {...props} />)
    expect(screen.getByRole('textbox', { name: 'Primary state' })).toBe(primary)
    expect(primary.parentElement).not.toHaveAttribute('inert')
    expect(screen.getByRole('textbox', { name: 'Inspector state' })).toBe(inspector)
    expect(inspector).toHaveValue('Unsaved comment')
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

})
