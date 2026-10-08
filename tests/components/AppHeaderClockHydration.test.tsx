import { act } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppHeader } from '@/components/AppHeader'

vi.mock('@/components/UserMenu', () => ({ UserMenu: () => <div>User menu</div> }))
vi.mock('@/hooks/use-fullscreen', () => ({ useFullscreen: () => ({ isFullscreen: false, toggle: vi.fn() }) }))
vi.mock('@/hooks/use-keyboard-shortcut-hint', () => ({ useKeyboardShortcutHint: () => ({ fullscreen: 'Ctrl Shift F' }) }))
vi.mock('@/ui', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }))

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  container = undefined
  vi.useRealTimers()
})

// AppShell, including its development-only AdminPrototype consumer, reuses this
// clock owner. The snapshot and hydration behavior belongs to AppHeader.
describe('AppHeader clock hydration', () => {
  it.each([
    ['minute', '2026-10-06T03:20:59Z', '2026-10-06T03:21:01Z', 'Mon Oct 5', '11:21 PM'],
    ['Toronto date', '2026-10-06T03:59:59Z', '2026-10-06T04:00:01Z', 'Tue Oct 6', '12:00 AM'],
  ])('preserves server DOM across a %s boundary and resumes live ticks', async (_boundary, serverTime, clientTime, date, time) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(serverTime))
    const header = <AppHeader initialNow={Date.parse(serverTime)} examModeHeader={{ testTitle: 'Unit Test', exitsCount: 0, awayTotalSeconds: 0 }} />
    container = document.createElement('div')
    container.innerHTML = renderToString(header)
    document.body.appendChild(container)
    const serverHeader = container.querySelector('header')
    const serverClock = container.querySelector('[data-testid="header-date-time"]')
    const onRecoverableError = vi.fn()

    vi.setSystemTime(new Date(clientTime))
    await act(async () => {
      root = hydrateRoot(container!, header, { onRecoverableError })
    })

    expect(onRecoverableError).not.toHaveBeenCalled()
    expect(container.querySelector('header')).toBe(serverHeader)
    expect(container.querySelector('[data-testid="header-date-time"]')).toBe(serverClock)
    expect(serverClock).toHaveTextContent(date)
    expect(serverClock).toHaveTextContent(time)
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(serverClock).toHaveTextContent(time === '12:00 AM' ? '12:01 AM' : '11:22 PM')
    await act(async () => root?.unmount())
    root = undefined
    expect(vi.getTimerCount()).toBe(0)
  })
})
