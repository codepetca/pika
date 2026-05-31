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
      <button onClick={() => setRouteKey('calendar-teacher')}>go-calendar</button>
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
  const { isOpen, enabled, setOpen } = useRightSidebar()
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>open-right-sidebar</button>
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
  it('closes sidebar when switching to a tab with enabled: false', () => {
    render(<TestHarness initialRouteKey="calendar-teacher" />)

    act(() => {
      screen.getByText('open-right-sidebar').click()
    })
    expect(screen.getByTestId('open').textContent).toBe('true')

    // Switch to assignments-student: enabled=false
    act(() => {
      screen.getByText('go-assignments').click()
    })

    expect(screen.getByTestId('enabled').textContent).toBe('false')
    expect(screen.getByTestId('open').textContent).toBe('false')
  })

  it('keeps teacher assignment routes disabled', () => {
    render(<TestHarness initialRouteKey="today" />)

    // Go to teacher assignment summary: external sidebar is disabled.
    act(() => {
      screen.getByText('go-teacher-list').click()
    })
    expect(screen.getByTestId('enabled').textContent).toBe('false')
    expect(screen.getByTestId('open').textContent).toBe('false')

    // Go to teacher assignment workspace: it uses the integrated work-surface split.
    act(() => {
      screen.getByText('go-teacher-viewing').click()
    })
    expect(screen.getByTestId('enabled').textContent).toBe('false')
    expect(screen.getByTestId('open').textContent).toBe('false')
  })

  it('keeps the external sidebar disabled for teacher tests', () => {
    render(<TestHarness initialRouteKey="calendar-teacher" />)

    act(() => {
      screen.getByText('open-right-sidebar').click()
    })
    expect(screen.getByTestId('open').textContent).toBe('true')

    act(() => {
      screen.getByText('go-tests').click()
    })

    expect(screen.getByTestId('enabled').textContent).toBe('false')
    expect(screen.getByTestId('open').textContent).toBe('false')
  })

  it('keeps the Today external sidebar disabled', () => {
    render(<TestHarness initialRouteKey="calendar-teacher" />)

    act(() => {
      screen.getByText('open-right-sidebar').click()
    })
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
