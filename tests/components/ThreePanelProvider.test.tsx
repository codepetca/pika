import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import {
  ThreePanelProvider,
  useRightSidebar,
} from '@/components/layout/ThreePanelProvider'
import type { RouteKey } from '@/lib/layout-config'

// Mock writeCookie to avoid real cookie writes
vi.mock('@/lib/cookies', () => ({
  writeCookie: vi.fn(),
}))

/** Test harness that exposes right sidebar state and allows routeKey changes */
function TestHarness({ initialRouteKey }: { initialRouteKey: RouteKey }) {
  const [routeKey, setRouteKey] = useState(initialRouteKey)

  return (
    <>
      <button onClick={() => setRouteKey('today')}>go-today</button>
      <button onClick={() => setRouteKey('assignments-student')}>go-assignments</button>
      <button onClick={() => setRouteKey('assignments-teacher-viewing')}>go-teacher-viewing</button>
      <button onClick={() => setRouteKey('quizzes-teacher')}>go-quizzes</button>
      <button onClick={() => setRouteKey('roster')}>go-roster</button>
      <ThreePanelProvider
        routeKey={routeKey}
        initialLeftExpanded={false}
      >
        <SidebarStatus />
      </ThreePanelProvider>
    </>
  )
}

function SidebarStatus() {
  const { isOpen, enabled } = useRightSidebar()
  return (
    <div>
      <span data-testid="enabled">{String(enabled)}</span>
      <span data-testid="open">{String(isOpen)}</span>
    </div>
  )
}

describe('ThreePanelProvider right sidebar sync on routeKey change', () => {
  it('opens sidebar when switching to a tab with defaultOpen: true', () => {
    render(<TestHarness initialRouteKey="assignments-student" />)

    // assignments-student: enabled=false, so sidebar is closed
    expect(screen.getByTestId('enabled').textContent).toBe('false')
    expect(screen.getByTestId('open').textContent).toBe('false')

    // Switch to teacher assignment viewing: enabled=true, defaultOpen=true
    act(() => {
      screen.getByText('go-teacher-viewing').click()
    })

    expect(screen.getByTestId('enabled').textContent).toBe('true')
    expect(screen.getByTestId('open').textContent).toBe('true')
  })

  it('closes sidebar when switching to a tab with enabled: false', () => {
    render(<TestHarness initialRouteKey="assignments-teacher-viewing" />)

    // assignments-teacher-viewing: enabled=true, defaultOpen=true
    expect(screen.getByTestId('open').textContent).toBe('true')

    // Switch to assignments-student: enabled=false
    act(() => {
      screen.getByText('go-assignments').click()
    })

    expect(screen.getByTestId('enabled').textContent).toBe('false')
    expect(screen.getByTestId('open').textContent).toBe('false')
  })

  it('reopens sidebar when returning to a default-open tab after visiting disabled tab', () => {
    render(<TestHarness initialRouteKey="assignments-teacher-viewing" />)

    expect(screen.getByTestId('open').textContent).toBe('true')

    // Go to assignments (disabled sidebar)
    act(() => {
      screen.getByText('go-assignments').click()
    })
    expect(screen.getByTestId('open').textContent).toBe('false')

    // Return to a default-open route — this is the core bug scenario
    act(() => {
      screen.getByText('go-teacher-viewing').click()
    })
    expect(screen.getByTestId('open').textContent).toBe('true')
  })

  it('opens sidebar when switching between two enabled tabs with defaultOpen', () => {
    render(<TestHarness initialRouteKey="today" />)

    // Go to assignments (disabled)
    act(() => {
      screen.getByText('go-assignments').click()
    })
    expect(screen.getByTestId('open').textContent).toBe('false')

    // Go to teacher assignment viewing (enabled, defaultOpen: true)
    act(() => {
      screen.getByText('go-teacher-viewing').click()
    })
    expect(screen.getByTestId('enabled').textContent).toBe('true')
    expect(screen.getByTestId('open').textContent).toBe('true')
  })

  it('keeps the external sidebar disabled for teacher quizzes', () => {
    render(<TestHarness initialRouteKey="assignments-teacher-viewing" />)

    expect(screen.getByTestId('open').textContent).toBe('true')

    act(() => {
      screen.getByText('go-quizzes').click()
    })

    expect(screen.getByTestId('enabled').textContent).toBe('false')
    expect(screen.getByTestId('open').textContent).toBe('false')
  })

  it('closes sidebar when switching from a default-open tab to an enabled tab with defaultOpen: false', () => {
    render(<TestHarness initialRouteKey="assignments-teacher-viewing" />)

    // assignments-teacher-viewing: enabled=true, defaultOpen=true
    expect(screen.getByTestId('open').textContent).toBe('true')

    // Switch to roster: enabled=true, defaultOpen=false
    act(() => {
      screen.getByText('go-roster').click()
    })

    expect(screen.getByTestId('enabled').textContent).toBe('true')
    expect(screen.getByTestId('open').textContent).toBe('false')
  })

  it('keeps the Today external sidebar disabled', () => {
    render(<TestHarness initialRouteKey="assignments-teacher-viewing" />)

    expect(screen.getByTestId('open').textContent).toBe('true')

    act(() => {
      screen.getByText('go-today').click()
    })

    expect(screen.getByTestId('enabled').textContent).toBe('false')
    expect(screen.getByTestId('open').textContent).toBe('false')
  })
})
