import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CalendarActionBar, CalendarDateNavigator, getCalendarHeaderLabel } from '@/components/CalendarActionBar'

describe('CalendarActionBar', () => {
  it('keeps date-only term boundaries on their classroom calendar dates', () => {
    expect(getCalendarHeaderLabel(
      'all',
      new Date(2025, 0, 1),
      '2025-01-01',
      '2025-06-30',
    )).toBe('Jan 1, 2025 - Jun 30, 2025')
  })

  it('exposes named date navigation controls', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    const onLabelClick = vi.fn()

    render(
      <CalendarDateNavigator
        label="July 2026"
        onPrev={onPrev}
        onNext={onNext}
        onLabelClick={onLabelClick}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    fireEvent.click(screen.getByRole('button', { name: 'Go to today' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(onPrev).toHaveBeenCalledOnce()
    expect(onLabelClick).toHaveBeenCalledOnce()
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('can join the date arrows directly to a chevron-free date button', () => {
    render(
      <CalendarDateNavigator
        label="Aug 17"
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onLabelClick={vi.fn()}
        joined
      />,
    )

    const dateButton = screen.getByRole('button', { name: 'Go to today' })
    expect(dateButton.parentElement).toHaveClass('overflow-hidden', 'border-border-strong')
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveClass('border-r')
    expect(screen.getByRole('button', { name: 'Next' })).toHaveClass('border-l')
    expect(dateButton.querySelector('svg')).toBeNull()
  })

  it('exposes the calendar view control and changes modes', () => {
    const onViewModeChange = vi.fn()

    render(
      <CalendarActionBar
        viewMode="week"
        currentDate={new Date(2026, 6, 21)}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onToday={vi.fn()}
        onViewModeChange={onViewModeChange}
      />,
    )

    const viewControl = screen.getByRole('group', { name: 'Calendar view' })
    expect(viewControl).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    expect(onViewModeChange).toHaveBeenCalledWith('month')
  })
})
