import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TeacherWorkSurfaceModeBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceModeBar'

describe('TeacherWorkSurfaceModeBar', () => {
  it('renders workspace modes, center controls, status, and trailing controls', () => {
    render(
      <TeacherWorkSurfaceModeBar
        modes={[
          { id: 'overview', label: 'Class' },
          { id: 'details', label: 'Individual' },
        ]}
        activeMode="overview"
        onModeChange={vi.fn()}
        center={<button type="button">AI Grade</button>}
        status={<span>Updating</span>}
        trailing={<button type="button">Edit assignment</button>}
      />,
    )

    expect(screen.getByRole('tablist', { name: 'Workspace modes' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Class' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Individual' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('button', { name: 'AI Grade' })).toBeInTheDocument()
    expect(screen.getByText('Updating')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit assignment' })).toBeInTheDocument()
  })

  it('delegates mode changes while respecting disabled modes', () => {
    const onModeChange = vi.fn()

    render(
      <TeacherWorkSurfaceModeBar
        modes={[
          { id: 'overview', label: 'Class' },
          { id: 'details', label: 'Individual', disabled: true },
        ]}
        activeMode="overview"
        onModeChange={onModeChange}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Class' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Individual' }))

    expect(onModeChange).toHaveBeenCalledTimes(1)
    expect(onModeChange).toHaveBeenCalledWith('overview')
    expect(screen.getByRole('tab', { name: 'Individual' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'Individual' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('supports keyboard navigation between enabled tabs', () => {
    const onModeChange = vi.fn()

    render(
      <TeacherWorkSurfaceModeBar
        modes={[
          { id: 'overview', label: 'Class' },
          { id: 'details', label: 'Individual' },
          { id: 'analytics', label: 'Analytics', disabled: true },
        ]}
        activeMode="overview"
        onModeChange={onModeChange}
      />,
    )

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Class' }), { key: 'ArrowRight' })
    expect(onModeChange).toHaveBeenLastCalledWith('details')

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Individual' }), { key: 'ArrowRight' })
    expect(onModeChange).toHaveBeenLastCalledWith('overview')

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Class' }), { key: 'End' })
    expect(onModeChange).toHaveBeenLastCalledWith('details')
  })
})
