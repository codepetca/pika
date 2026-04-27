import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'

describe('TeacherWorkSurfaceShell', () => {
  it('renders summary state with the standard teacher page rhythm', () => {
    const { container } = render(
      <TeacherWorkSurfaceShell
        state="summary"
        primary={<button type="button">New Assignment</button>}
        feedback={<div role="status">Loaded assignments</div>}
        summary={<div>Assignment list</div>}
        workspace={<div>Workspace</div>}
      />,
    )

    expect(screen.getByRole('button', { name: 'New Assignment' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loaded assignments')
    expect(screen.getByText('Assignment list')).toBeInTheDocument()
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument()

    const content = screen.getByText('Assignment list').parentElement?.parentElement
    expect(content).toHaveClass('flex', 'flex-col', 'gap-3')
    expect(content).not.toHaveClass('px-0')
    expect(container.querySelector('.rounded-b-lg.border.border-border.bg-surface')).toBeNull()
  })

  it('renders workspace state with gutterless content and the selected-workspace frame', () => {
    render(
      <TeacherWorkSurfaceShell
        state="workspace"
        primary={<div>Personal Narrative Essay</div>}
        trailing={<button type="button">Toggle</button>}
        feedback={<div role="alert">Workspace warning</div>}
        summary={<div>Assignment list</div>}
        workspace={<div>Student table</div>}
      />,
    )

    expect(screen.getByText('Personal Narrative Essay')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Toggle' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Workspace warning')
    expect(screen.queryByText('Assignment list')).not.toBeInTheDocument()
    expect(screen.getByText('Student table')).toBeInTheDocument()

    const content = screen.getByText('Student table').parentElement?.parentElement?.parentElement
    expect(content).toHaveClass('px-0', 'pt-0', 'flex-1')
    const frame = screen.getByText('Student table').parentElement?.parentElement
    expect(frame).toHaveClass('rounded-b-lg', 'border', 'border-border', 'bg-surface')
  })

  it('supports standalone selected-workspace frames for non-tabbed workspaces', () => {
    render(
      <TeacherWorkSurfaceShell
        state="workspace"
        primary={<div>Gradebook</div>}
        summary={<div>Summary</div>}
        workspace={<div>Gradebook table</div>}
        workspaceFrame="standalone"
      />,
    )

    const frame = screen.getByText('Gradebook table').parentElement?.parentElement
    expect(frame).toHaveClass('rounded-lg', 'border', 'border-border', 'bg-surface')
    expect(frame).not.toHaveClass('rounded-b-lg')
  })

  it('keeps workspace children mounted across non-destructive shell updates', () => {
    const onMount = vi.fn()

    function StatefulWorkspace() {
      useEffect(() => {
        onMount()
      }, [])

      return <div>Stateful workspace</div>
    }

    const { rerender } = render(
      <TeacherWorkSurfaceShell
        state="workspace"
        primary={<div>Assignment A</div>}
        feedback={<div>Initial feedback</div>}
        summary={<div>Summary</div>}
        workspace={<StatefulWorkspace />}
      />,
    )

    rerender(
      <TeacherWorkSurfaceShell
        state="workspace"
        primary={<div>Assignment A</div>}
        feedback={<div>Updated feedback</div>}
        trailing={<button type="button">Open menu</button>}
        summary={<div>Summary</div>}
        workspace={<StatefulWorkspace />}
      />,
    )

    expect(screen.getByText('Stateful workspace')).toBeInTheDocument()
    expect(screen.getByText('Updated feedback')).toBeInTheDocument()
    expect(onMount).toHaveBeenCalledTimes(1)
  })
})
