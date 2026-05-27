import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import {
  ThreePanelProvider,
  useMobileDrawer,
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
      <button onClick={() => setRouteKey('assignments-teacher-list')}>go-teacher-list</button>
      <button onClick={() => setRouteKey('assignments-teacher-viewing')}>go-teacher-viewing</button>
      <button onClick={() => setRouteKey('tests-teacher')}>go-tests</button>
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

function MobileDrawerStatus() {
  const { isLeftOpen, openLeft } = useMobileDrawer()

  return (
    <div>
      <button onClick={openLeft}>open-left-drawer</button>
      <span data-testid="mobile-left-open">{String(isLeftOpen)}</span>
    </div>
  )
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  })
  window.dispatchEvent(new Event('resize'))
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

  it('keeps the external sidebar disabled for teacher tests', () => {
    render(<TestHarness initialRouteKey="assignments-teacher-viewing" />)

    expect(screen.getByTestId('open').textContent).toBe('true')

    act(() => {
      screen.getByText('go-tests').click()
    })

    expect(screen.getByTestId('enabled').textContent).toBe('false')
    expect(screen.getByTestId('open').textContent).toBe('false')
  })

  it('closes sidebar when switching from a default-open tab to an enabled tab with defaultOpen: false', () => {
    render(<TestHarness initialRouteKey="assignments-teacher-viewing" />)

    // assignments-teacher-viewing: enabled=true, defaultOpen=true
    expect(screen.getByTestId('open').textContent).toBe('true')

    // Switch to teacher assignment list: enabled=true, defaultOpen=false
    act(() => {
      screen.getByText('go-teacher-list').click()
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

  it('closes mobile drawer state when crossing to the desktop breakpoint', () => {
    act(() => {
      setViewportWidth(390)
    })

    render(
      <ThreePanelProvider routeKey="attendance" initialLeftExpanded={false}>
        <MobileDrawerStatus />
      </ThreePanelProvider>,
    )

    act(() => {
      screen.getByText('open-left-drawer').click()
    })
    expect(screen.getByTestId('mobile-left-open').textContent).toBe('true')

    act(() => {
      setViewportWidth(1024)
    })
    expect(screen.getByTestId('mobile-left-open').textContent).toBe('false')
  })
})
