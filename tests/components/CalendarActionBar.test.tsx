import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CalendarActionBar, CalendarDateNavigator } from '@/components/CalendarActionBar'

describe('CalendarActionBar', () => {
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
