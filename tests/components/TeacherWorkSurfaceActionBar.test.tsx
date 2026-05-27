import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThreePanelProvider } from '@/components/layout/ThreePanelProvider'
import { ThreePanelShell } from '@/components/layout/ThreePanelShell'
import {
  TeacherWorkSurfaceActionBar,
  TeacherWorkSurfaceFloatingActionCluster,
} from '@/components/teacher-work-surface/TeacherWorkSurfaceActionBar'

vi.mock('@/lib/cookies', () => ({
  writeCookie: vi.fn(),
}))

describe('TeacherWorkSurfaceFloatingActionCluster', () => {
  it('centers against the shell main content area on desktop', () => {
    const { container } = render(
      <ThreePanelProvider routeKey="attendance" initialLeftExpanded={true}>
        <ThreePanelShell>
          <TeacherWorkSurfaceFloatingActionCluster>
            <button type="button">Jump to today</button>
          </TeacherWorkSurfaceFloatingActionCluster>
        </ThreePanelShell>
      </ThreePanelProvider>,
    )

    const shell = container.firstElementChild as HTMLElement
    expect(shell.style.getPropertyValue('--left-width')).toBe('240px')
    expect(shell.style.getPropertyValue('--right-width')).toBe('0px')
    expect(shell.style.getPropertyValue('--main-content-center-x')).toBe(
      'calc(var(--left-width) + ((100vw - var(--left-width) - var(--right-width)) / 2))',
    )

    const cluster = screen.getByRole('button', { name: 'Jump to today' }).parentElement
    expect(cluster).toHaveClass('fixed', 'top-[3.25rem]', 'z-40', 'w-max')
    expect(cluster?.className).toContain('max-w-[calc(100vw-1rem)]')
    expect(cluster).toHaveClass('rounded-lg', 'bg-surface/95', 'shadow-elevated', 'backdrop-blur')
    expect(cluster).toHaveClass('left-1/2')
    expect(cluster?.className).toContain('lg:left-[var(--main-content-center-x,50%)]')
    expect(cluster?.className).toContain('lg:transition-[left]')
    expect(cluster?.className).toContain('lg:duration-200')
    expect(cluster?.className).toContain('lg:ease-out')
  })

  it('renders the optional calendar date label in the scrollable action bar left slot', () => {
    render(
      <TeacherWorkSurfaceActionBar
        label="May 2026"
        center={<button type="button">Tue May 5</button>}
        centerPlacement="floating"
      />,
    )

    const label = screen.getByText('May 2026')
    expect(label).toBeInTheDocument()
    expect(label).toHaveClass('justify-self-start', 'font-semibold', 'text-text-default')

    const floatingCluster = screen.getByRole('button', { name: 'Tue May 5' }).parentElement
    expect(floatingCluster).toHaveClass('fixed')
    expect(floatingCluster?.className).toContain('max-w-[calc(100vw-1rem)]')
  })

  it('keeps inline center actions in the normal grid flow', () => {
    render(
      <TeacherWorkSurfaceActionBar
        label="Assignments"
        center={<button type="button">New Assignment</button>}
        trailing={<button type="button">Settings</button>}
      />,
    )

    const center = screen.getByRole('button', { name: 'New Assignment' }).parentElement
    expect(center).toHaveClass('justify-self-center')
    expect(center).not.toHaveClass('fixed')
    expect(screen.getByRole('button', { name: 'Settings' }).parentElement).toHaveClass('justify-self-end')
  })
})
