import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThreePanelProvider } from '@/components/layout/ThreePanelProvider'
import { ThreePanelShell } from '@/components/layout/ThreePanelShell'
import { TeacherWorkSurfaceFloatingActionCluster } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionBar'

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
    expect(cluster).toHaveClass('left-1/2')
    expect(cluster?.className).toContain('lg:left-[var(--main-content-center-x,50%)]')
    expect(cluster?.className).toContain('lg:transition-[left]')
    expect(cluster?.className).toContain('lg:duration-200')
    expect(cluster?.className).toContain('lg:ease-out')
  })
})
