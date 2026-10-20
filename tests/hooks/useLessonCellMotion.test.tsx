import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState, type CSSProperties } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLessonCellMotion } from '@/components/useLessonCellMotion'

let visibleHeight = 80
let naturalHeight = 200
let resize: () => void
let motionChanged: () => void
let reduced = false
let frames: Map<number, FrameRequestCallback>
let nextFrame = 0

function Harness({ owner = 'day-1', compact = false }: { owner?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const { outerRef, innerRef, prepare } = useLessonCellMotion(open, owner, compact)
  return <><button onClick={() => { prepare(); setOpen(value => !value) }}>Toggle</button>
    <div data-testid="outer" ref={outerRef} style={{ '--motion-duration-standard': '200ms' } as CSSProperties}>
      <div data-testid="inner" ref={innerRef}>{open ? 'Editor' : 'Preview'}</div>
    </div></>
}

function setup() {
  visibleHeight = 80
  naturalHeight = 200
  reduced = false
  frames = new Map()
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextFrame
    frames.set(id, callback)
    return id
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)))
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect() {}
  })
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
    get matches() { return reduced }, media: query, onchange: null,
    addEventListener: (_event: string, callback: EventListenerOrEventListenerObject) => { motionChanged = callback as () => void },
    removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
  const view = render(<Harness />)
  const outer = screen.getByTestId('outer')
  const inner = screen.getByTestId('inner')
  vi.spyOn(outer, 'getBoundingClientRect').mockImplementation(() => ({ height: visibleHeight }) as DOMRect)
  vi.spyOn(inner, 'getBoundingClientRect').mockImplementation(() => ({ height: naturalHeight }) as DOMRect)
  const flushFrame = () => act(() => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach(callback => callback(0))
  })
  return { ...view, outer, flushFrame }
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('calendar disclosure geometry', () => {
  it('interpolates a neighboring preview on compact-only disclosure and reversal', () => {
    const { outer, rerender, flushFrame } = setup()
    act(() => resize()) // Cache the last committed geometry before density changes.
    rerender(<Harness compact />)
    expect(outer.style.height).toBe('80px')
    flushFrame()
    expect(outer.style.height).toBe('200px')
    visibleHeight = 140
    act(() => resize())
    naturalHeight = 80
    rerender(<Harness compact={false} />)
    expect(outer.style.height).toBe('140px')
    flushFrame()
    expect(outer.style.height).toBe('80px')
    act(() => vi.advanceTimersByTime(250))
    expect(outer.style.height).toBe('')
    naturalHeight = 300 // Typing, refresh and resize are not disclosure events.
    act(() => resize())
    expect(outer.style.height).toBe('')
  })

  it('does not use another owner\'s compact geometry or animate compact changes with reduced motion', () => {
    const { outer, rerender } = setup()
    act(() => resize())
    rerender(<Harness owner="day-2" compact />)
    expect(outer.style.height).toBe('')
    reduced = true
    rerender(<Harness owner="day-2" compact={false} />)
    expect(outer.style.height).toBe('')
    expect(frames.size).toBe(0)
  })

  it('keeps natural sizing when ResizeObserver is unavailable', () => {
    const { outer, rerender } = setup()
    vi.stubGlobal('ResizeObserver', undefined)
    fireEvent.click(screen.getByText('Toggle'))
    expect(outer.style.height).toBe('')
    rerender(<Harness compact />)
    expect(outer.style.height).toBe('')
    expect(frames.size).toBe(0)
  })

  it('starts at visible height, measures late editor content and releases natural sizing', () => {
    const { outer, flushFrame } = setup()
    fireEvent.click(screen.getByText('Toggle'))
    expect(outer.style.height).toBe('80px')
    flushFrame()
    expect(outer.style.height).toBe('200px')
    act(() => vi.advanceTimersByTime(150))
    naturalHeight = 240
    act(() => resize())
    expect(outer.style.height).toBe('240px')
    act(() => vi.advanceTimersByTime(150))
    expect(outer.style.height).toBe('240px')
    act(() => vi.advanceTimersByTime(100))
    expect(outer.style.height).toBe('')
    naturalHeight = 300
    act(() => resize())
    expect(outer.style.height).toBe('')
  })

  it('holds the visible opening height until the asynchronously mounted editor has geometry', () => {
    const { outer, flushFrame } = setup()
    naturalHeight = 0
    fireEvent.click(screen.getByText('Toggle'))
    flushFrame()
    expect(outer.style.height).toBe('80px')
    naturalHeight = 200
    act(() => resize())
    expect(outer.style.height).toBe('200px')
    act(() => vi.advanceTimersByTime(250))
    expect(outer.style.height).toBe('')
  })

  it('reverses from current interpolated height and cancels pending work on owner removal', () => {
    const { outer, flushFrame, rerender, unmount } = setup()
    fireEvent.click(screen.getByText('Toggle'))
    flushFrame()
    visibleHeight = 150
    naturalHeight = 80
    fireEvent.click(screen.getByText('Toggle'))
    expect(outer.style.height).toBe('150px')
    flushFrame()
    expect(outer.style.height).toBe('80px')
    rerender(<Harness owner="day-2" />)
    expect(outer.style.height).toBe('')
    fireEvent.click(screen.getByText('Toggle'))
    expect(frames.size).toBe(1)
    unmount()
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles immediately when reduced motion is enabled and skips subsequent disclosure', () => {
    const { outer, flushFrame } = setup()
    fireEvent.click(screen.getByText('Toggle'))
    flushFrame()
    reduced = true
    act(() => motionChanged())
    expect(outer.style.height).toBe('')
    expect(vi.getTimerCount()).toBe(0)
    fireEvent.click(screen.getByText('Toggle'))
    expect(outer.style.height).toBe('')
    expect(frames.size).toBe(0)
  })
})
