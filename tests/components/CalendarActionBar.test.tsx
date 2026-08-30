import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CalendarActionBar, getCalendarHeaderLabel } from '@/components/CalendarActionBar'
import { DateNavigator } from '@/components/DateNavigator'

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
      <DateNavigator
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
      <DateNavigator
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

  it('renders an optional compact subtitle inside the date button', () => {
    render(
      <DateNavigator
        label="Aug 17"
        subtitle="Yesterday"
        onLabelClick={vi.fn()}
      />,
    )

    const dateButton = screen.getByRole('button', { name: 'Go to today' })
    expect(dateButton).toHaveTextContent('Aug 17Yesterday')
    expect(screen.getByText('Yesterday')).toHaveClass('text-xs', 'font-normal')
  })

  it('keeps a joined static date label vertically centered without a subtitle', () => {
    render(
      <DateNavigator
        label="All dates"
        showNavigation={false}
        joined
      />,
    )

    expect(screen.getByText('All dates').parentElement).toHaveClass(
      'flex',
      'min-h-control',
      'items-center',
      'justify-center',
    )
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
    const contextBar = screen.getByRole('region', { name: 'Calendar controls' })
    expect(contextBar).toHaveClass('grid')
    expect(viewControl.closest('.fixed')).toBeNull()
    expect(viewControl).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    expect(onViewModeChange).toHaveBeenCalledWith('month')
  })
})
