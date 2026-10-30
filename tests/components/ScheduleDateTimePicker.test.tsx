import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ScheduleDateTimePicker } from '@/components/ScheduleDateTimePicker'

describe('ScheduleDateTimePicker', () => {
  it('shows the requested date format while retaining the native date control', () => {
    const onDateChange = vi.fn()
    const { rerender } = render(
      <ScheduleDateTimePicker date="2026-10-30" time="09:00" minDate="2026-10-01" isFutureValid onDateChange={onDateChange} onTimeChange={vi.fn()} onConfirm={vi.fn()} />,
    )
    const dateInput = screen.getByLabelText('Date (Toronto)')
    expect(dateInput).toHaveValue('2026-10-30')
    expect(dateInput).toHaveAttribute('min', '2026-10-01')
    expect(screen.getByDisplayValue('Fri Oct 30, 2026')).toHaveAttribute('aria-hidden', 'true')
    fireEvent.focus(dateInput)
    expect(dateInput).toHaveClass('opacity-100')
    fireEvent.blur(dateInput)
    expect(dateInput).toHaveClass('opacity-0')
    fireEvent.change(dateInput, { target: { value: '2026-11-02' } })
    expect(onDateChange).toHaveBeenCalledWith('2026-11-02')
    rerender(<ScheduleDateTimePicker date="" time="09:00" isFutureValid onDateChange={onDateChange} onTimeChange={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.getByPlaceholderText('Choose a date')).toHaveValue('')
  })
})
