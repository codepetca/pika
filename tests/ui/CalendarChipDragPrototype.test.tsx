import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  CalendarChipDragPrototype,
  PROTOTYPE_CALENDAR_ITEMS,
  getKeyboardTargetDate,
  movePrototypeCalendarItem,
} from '@/app/__ui/CalendarChipDragPrototype'
import { KeyboardCode } from '@dnd-kit/core'
import { TooltipProvider } from '@/ui'

describe('CalendarChipDragPrototype', () => {
  it('moves only movable items in the local fixture reducer', () => {
    const moved = movePrototypeCalendarItem(PROTOTYPE_CALENDAR_ITEMS, 'assignment-field-notes', '2026-09-18')
    expect(moved.find((item) => item.id === 'assignment-field-notes')?.date).toBe('2026-09-18')

    const locked = movePrototypeCalendarItem(PROTOTYPE_CALENDAR_ITEMS, 'announcement-posted', '2026-09-18')
    expect(locked.find((item) => item.id === 'announcement-posted')?.date).toBe('2026-09-17')
  })

  it('advances repeated keyboard moves by day or week and stops at the visible bounds', () => {
    const dates = Array.from({ length: 14 }, (_, index) => `2026-09-${String(13 + index).padStart(2, '0')}`)
    const firstMove = getKeyboardTargetDate(dates, '2026-09-15', KeyboardCode.Right)
    expect(firstMove).toBe('2026-09-16')
    expect(getKeyboardTargetDate(dates, firstMove!, KeyboardCode.Right)).toBe('2026-09-17')
    expect(getKeyboardTargetDate(dates, '2026-09-15', KeyboardCode.Down)).toBe('2026-09-22')
    expect(getKeyboardTargetDate(dates, dates[0], KeyboardCode.Left)).toBeNull()
    expect(getKeyboardTargetDate(dates, dates[13], KeyboardCode.Right)).toBeNull()
  })

  it('exposes movable controls, keyboard instructions, and a focusable locked reason', async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><CalendarChipDragPrototype viewMode="week" currentDate={new Date('2026-09-14T12:00:00')} /></TooltipProvider>)

    const movable = screen.getByRole('button', { name: 'Move Assignment Field notes' })
    expect(movable).toBeEnabled()
    expect(movable).toHaveAccessibleDescription(/Left and Right Arrow to move one day/)
    const locked = screen.getByRole('button', { name: /Announcement Trip reminder, locked: Published announcements/ })
    expect(locked).toHaveAttribute('aria-disabled', 'true')
    for (let index = 0; index < 12 && document.activeElement !== locked; index += 1) await user.tab()
    expect(locked).toHaveFocus()
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

  it('moves across repeated keyboard targets and cancels without moving', async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><CalendarChipDragPrototype viewMode="week" currentDate={new Date('2026-09-14T12:00:00')} /></TooltipProvider>)

    const fieldNotes = screen.getByRole('button', { name: 'Move Assignment Field notes' })
    fieldNotes.focus()
    await user.keyboard('[Space][ArrowRight][ArrowRight]')
    expect(screen.getByRole('group', { name: 'Thursday, September 17, 2026' })).toHaveAttribute('data-drop-target', 'true')
    await user.keyboard('[Space]')
    expect(within(screen.getByRole('group', { name: 'Thursday, September 17, 2026' })).getByText('Field notes')).toBeVisible()

    const labGroups = screen.getByRole('button', { name: 'Move Announcement Lab groups' })
    labGroups.focus()
    await user.keyboard('[Space][ArrowLeft][Escape]')
    expect(within(screen.getByRole('group', { name: 'Tuesday, September 15, 2026' })).getByText('Lab groups')).toBeVisible()
  })
})
