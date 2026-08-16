import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CalendarSourceErrors } from '@/components/CalendarSourceErrors'

describe('CalendarSourceErrors', () => {
  it('does not render when every calendar source is available', () => {
    render(<CalendarSourceErrors failures={[]} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('announces a custom failure and exposes its retry action', () => {
    const onRetry = vi.fn()

    render(
      <CalendarSourceErrors
        message="Some lesson plan changes could not be saved."
        failures={[{
          id: 'lesson-plans',
          label: 'lesson plan changes',
          isRetrying: false,
          onRetry,
        }]}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Some lesson plan changes could not be saved.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry lesson plan changes' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('disables a retry action while it is running', () => {
    render(
      <CalendarSourceErrors
        failures={[{
          id: 'class-days',
          label: 'class days',
          isRetrying: true,
          onRetry: vi.fn(),
        }]}
      />,
    )

    expect(screen.getByRole('button', { name: 'Retrying class days' })).toBeDisabled()
  })
})
