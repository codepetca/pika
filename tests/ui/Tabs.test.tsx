import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TabPanel, Tabs } from '@/ui'

describe('Tabs', () => {
  it('owns tab relationships, roving focus, and a 44px target', () => {
    render(
      <>
        <Tabs
          ariaLabel="Workspace modes"
          items={[
            { value: 'class', label: 'Class' },
            { value: 'disabled', label: 'Disabled', disabled: true },
            { value: 'individual', label: 'Individual' },
          ]}
          value="class"
          onValueChange={vi.fn()}
          getTabId={(value) => `${value}-tab`}
          getPanelId={(value) => `${value}-panel`}
        />
        <TabPanel id="class-panel" labelledBy="class-tab">
          Class content
        </TabPanel>
      </>,
    )

    const activeTab = screen.getByRole('tab', { name: 'Class' })
    const inactiveTab = screen.getByRole('tab', { name: 'Individual' })
    const panel = screen.getByRole('tabpanel', { name: 'Class' })

    const tabList = screen.getByRole('tablist', { name: 'Workspace modes' })
    expect(tabList).toHaveAttribute(
      'aria-orientation',
      'horizontal',
    )
    expect(tabList).toHaveClass('min-w-0', 'max-w-full', 'overflow-x-auto')
    expect(activeTab).toHaveAttribute('aria-selected', 'true')
    expect(activeTab).toHaveAttribute('aria-controls', 'class-panel')
    expect(activeTab).toHaveAttribute('tabindex', '0')
    expect(activeTab).toHaveClass('min-h-control', 'shrink-0', 'focus-visible:ring-foundation')
    expect(inactiveTab).toHaveAttribute('tabindex', '-1')
    expect(panel).toHaveAttribute('aria-labelledby', 'class-tab')
    expect(panel).not.toHaveAttribute('tabindex')
  })

  it('uses arrows, Home, and End to activate enabled tabs', () => {
    const onValueChange = vi.fn()
    render(
      <Tabs
        ariaLabel="Document type"
        items={[
          { value: 'link', label: 'Link' },
          { value: 'upload', label: 'PDF', disabled: true },
          { value: 'text', label: 'Text' },
        ]}
        value="link"
        onValueChange={onValueChange}
      />,
    )

    const link = screen.getByRole('tab', { name: 'Link' })
    const text = screen.getByRole('tab', { name: 'Text' })

    fireEvent.keyDown(link, { key: 'ArrowRight' })
    expect(onValueChange).toHaveBeenLastCalledWith('text')
    expect(text).toHaveFocus()

    fireEvent.keyDown(text, { key: 'ArrowRight' })
    expect(onValueChange).toHaveBeenLastCalledWith('link')
    expect(link).toHaveFocus()

    fireEvent.keyDown(link, { key: 'End' })
    expect(onValueChange).toHaveBeenLastCalledWith('text')

    fireEvent.keyDown(text, { key: 'Home' })
    expect(onValueChange).toHaveBeenLastCalledWith('link')
  })
})


describe('Tabs selected-tab visibility', () => {
  const items = [
    { value: 'first', label: 'First' },
    { value: 'middle', label: 'Middle' },
    { value: 'last', label: 'Last' },
  ]
  let width: number
  let positions: Record<string, { left: number; width: number }>
  let notifyResize: () => void
  let observe: ReturnType<typeof vi.fn>
  let disconnect: ReturnType<typeof vi.fn>

  const renderTabs = (value = 'last', nextItems = items) => (
    <Tabs ariaLabel="Scrollable modes" items={nextItems} value={value} onValueChange={vi.fn()} />
  )
  const list = () => screen.getByRole('tablist', { name: 'Scrollable modes' })

  beforeEach(() => {
    width = 200
    positions = {
      First: { left: 0, width: 100 },
      Middle: { left: 100, width: 100 },
      Last: { left: 200, width: 100 },
    }
    observe = vi.fn()
    disconnect = vi.fn()
    notifyResize = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this as unknown as ResizeObserver)
      }
      observe = observe
      disconnect = disconnect
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
      return this.getAttribute('role') === 'tablist' ? width : 0
    })
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function () {
      return this.getAttribute('role') === 'tablist' ? 500 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function () {
      return positions[this.textContent ?? '']?.left ?? 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
      return positions[this.textContent ?? '']?.width ?? 0
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const geometry = positions[this.textContent ?? '']
      const left = geometry ? 100 + geometry.left - (this.parentElement?.scrollLeft ?? 0) : 100
      const rectWidth = geometry ? geometry.width : width
      return { left, right: left + rectWidth, width: rectWidth, top: 0, bottom: 44, height: 44, x: left, y: 0, toJSON: () => ({}) }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('minimally reveals an initially selected later tab, including on owner remount', () => {
    const { unmount } = render(renderTabs())
    expect(list().scrollLeft).toBe(100)
    unmount()
    render(renderTabs())
    expect(list().scrollLeft).toBe(100)
  })

  it('reveals controlled selection on either edge without moving focus or an outer scroll owner', () => {
    const { rerender } = render(<div data-testid="outer"><input aria-label="Draft" />{renderTabs('first')}</div>)
    const outer = screen.getByTestId('outer')
    outer.scrollLeft = 37
    outer.scrollTop = 73
    list().scrollTop = 19
    const draft = screen.getByRole('textbox', { name: 'Draft' })
    draft.focus()
    rerender(<div data-testid="outer"><input aria-label="Draft" />{renderTabs('last')}</div>)
    expect(list().scrollLeft).toBe(100)
    expect(draft).toHaveFocus()
    expect(outer.scrollLeft).toBe(37)
    expect(outer.scrollTop).toBe(73)
    expect(list().scrollTop).toBe(19)
    rerender(<div data-testid="outer"><input aria-label="Draft" />{renderTabs('first')}</div>)
    expect(list().scrollLeft).toBe(0)
    expect(draft).toHaveFocus()
  })

  it('leaves fully visible selections in place instead of centering them', () => {
    render(renderTabs('middle'))
    expect(list().scrollLeft).toBe(0)
    act(notifyResize)
    expect(list().scrollLeft).toBe(0)
  })

  it('preserves manual browsing across fresh item arrays, unrelated renders and unchanged resize notifications', () => {
    const { rerender } = render(renderTabs())
    expect(list().scrollLeft).toBe(100)
    list().scrollLeft = 0
    rerender(renderTabs('last', items.map(item => ({ ...item }))))
    act(notifyResize)
    expect(list().scrollLeft).toBe(0)
  })

  it('reveals selection when the list shrinks and when earlier labels grow', () => {
    width = 300
    render(renderTabs())
    expect(list().scrollLeft).toBe(0)
    width = 200
    act(notifyResize)
    expect(list().scrollLeft).toBe(100)
    positions.First.width = 150
    positions.Middle.left = 150
    positions.Last.left = 250
    act(notifyResize)
    expect(list().scrollLeft).toBe(150)
    expect(observe).toHaveBeenCalledWith(screen.getByRole('tab', { name: 'First' }))
  })

  it('defers hidden selection until its list becomes visible', () => {
    width = 0
    render(renderTabs())
    expect(list().scrollLeft).toBe(0)
    width = 200
    act(notifyResize)
    expect(list().scrollLeft).toBe(100)
  })

  it('uses signed horizontal deltas for a selected tab clipped on the RTL left edge', () => {
    positions.Last.left = -100
    render(<div dir="rtl">{renderTabs()}</div>)
    expect(list().scrollLeft).toBe(-100)
    act(notifyResize)
    expect(list().scrollLeft).toBe(-100)
  })

  it('keeps an oversized label spanning the viewport stable and reveals one that is outside it', () => {
    positions.Last = { left: -50, width: 300 }
    const { unmount } = render(renderTabs())
    expect(list().scrollLeft).toBe(0)
    act(notifyResize)
    expect(list().scrollLeft).toBe(0)
    unmount()
    positions.Last.left = 250
    render(renderTabs())
    expect(list().scrollLeft).toBe(250)
    act(notifyResize)
    expect(list().scrollLeft).toBe(250)
  })

  it('does not activate a disabled selection and disconnects layout observation on unmount', () => {
    const onValueChange = vi.fn()
    const { unmount } = render(
      <Tabs ariaLabel="Scrollable modes" items={items.map(item => ({ ...item, disabled: item.value === 'last' }))} value="last" onValueChange={onValueChange} />,
    )
    expect(list().scrollLeft).toBe(100)
    expect(screen.getByRole('tab', { name: 'Last' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'First' })).toHaveAttribute('tabindex', '0')
    expect(onValueChange).not.toHaveBeenCalled()
    unmount()
    expect(disconnect).toHaveBeenCalled()
  })
})
