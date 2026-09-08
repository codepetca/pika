import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  CalendarChipDragPrototype,
  PROTOTYPE_CALENDAR_ITEMS,
  movePrototypeCalendarItem,
} from '@/app/__ui/CalendarChipDragPrototype'
import { TooltipProvider } from '@/ui'

describe('CalendarChipDragPrototype', () => {
  it('moves only movable items in the local fixture reducer', () => {
    const moved = movePrototypeCalendarItem(PROTOTYPE_CALENDAR_ITEMS, 'assignment-field-notes', '2026-09-18')
    expect(moved.find((item) => item.id === 'assignment-field-notes')?.date).toBe('2026-09-18')

    const locked = movePrototypeCalendarItem(PROTOTYPE_CALENDAR_ITEMS, 'announcement-posted', '2026-09-18')
    expect(locked.find((item) => item.id === 'announcement-posted')?.date).toBe('2026-09-17')
  })

  it('exposes movable and locked chips with explicit accessible names', () => {
    render(<TooltipProvider><CalendarChipDragPrototype viewMode="week" currentDate={new Date('2026-09-14T12:00:00')} /></TooltipProvider>)

    expect(screen.getByRole('button', { name: 'Move Assignment Field notes' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Announcement Trip reminder, locked' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Test Cell systems' })).toBeEnabled()
  })

  it('marks failure simulation as an explicit pressed state and can reset it', async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><CalendarChipDragPrototype viewMode="week" currentDate={new Date('2026-09-14T12:00:00')} /></TooltipProvider>)

    const failNext = screen.getByRole('button', { name: 'Fail next move' })
    expect(failNext).toHaveAttribute('aria-pressed', 'false')
    await user.click(failNext)
    expect(failNext).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Reset calendar prototype' }))
    expect(failNext).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders a named drop target for every visible day', () => {
    render(<TooltipProvider><CalendarChipDragPrototype viewMode="week" currentDate={new Date('2026-09-14T12:00:00')} /></TooltipProvider>)
    const day = screen.getByRole('group', { name: 'Tuesday, September 15, 2026' })
    expect(within(day).getByRole('button', { name: 'Move Assignment Field notes' })).toBeVisible()
    expect(screen.getAllByRole('group', { name: /September \d+, 2026/ })).toHaveLength(7)
  })
})
