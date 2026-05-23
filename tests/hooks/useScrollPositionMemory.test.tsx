import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useScrollPositionMemory } from '@/hooks/useScrollPositionMemory'

function ScrollMemoryHarness({
  memoryKey = 'assignment-1',
  storageKey = 'teacher-assignment-student-scroll:classroom-1:assignment-1',
}: {
  memoryKey?: string | null
  storageKey?: string | null
}) {
  const { scrollRef, preserveScrollPosition } = useScrollPositionMemory<HTMLDivElement>({
    key: memoryKey,
    storageKey,
    restoreToken: memoryKey,
  })

  return (
    <div
      ref={scrollRef}
      data-testid="scroll-pane"
      onScroll={preserveScrollPosition}
    />
  )
}

describe('useScrollPositionMemory', () => {
  afterEach(() => {
    window.sessionStorage.clear()
  })

  it('restores a persisted scroll position after the scroll pane remounts', () => {
    const { unmount } = render(<ScrollMemoryHarness />)
    const scrollPane = screen.getByTestId('scroll-pane') as HTMLDivElement
    scrollPane.scrollTop = 520
    fireEvent.scroll(scrollPane)

    unmount()
    render(<ScrollMemoryHarness />)

    expect(screen.getByTestId('scroll-pane')).toHaveProperty('scrollTop', 520)
  })

  it('keeps persisted scroll positions scoped by storage key', () => {
    window.sessionStorage.setItem(
      'teacher-assignment-student-scroll:classroom-1:assignment-1',
      JSON.stringify(520),
    )
    window.sessionStorage.setItem(
      'teacher-assignment-student-scroll:classroom-1:assignment-2',
      JSON.stringify(120),
    )

    render(
      <ScrollMemoryHarness
        memoryKey="assignment-2"
        storageKey="teacher-assignment-student-scroll:classroom-1:assignment-2"
      />,
    )

    expect(screen.getByTestId('scroll-pane')).toHaveProperty('scrollTop', 120)
  })
})
