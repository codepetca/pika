import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ClassroomError from '@/app/classrooms/[classroomId]/error'
import ClassroomLoading from '@/app/classrooms/[classroomId]/loading'
import ClassroomNotFound from '@/app/classrooms/[classroomId]/not-found'

vi.mock('@/components/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('classroom route page states', () => {
  it('uses the governed loading state inside the classroom shell skeleton', () => {
    render(<ClassroomLoading />)

    expect(screen.getByTestId('classroom-skeleton')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('data-page-state', 'loading')
    expect(screen.getByText('Loading classroom')).toBeInTheDocument()
  })

  it('keeps missing and unauthorized classrooms intentionally indistinguishable', () => {
    render(<ClassroomNotFound />)

    expect(screen.getByTestId('classroom-not-found')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveAttribute('data-page-state', 'forbidden')
    expect(screen.getByText('It may not exist, or you may not have access.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to classrooms' })).toHaveAttribute(
      'href',
      '/classrooms',
    )
  })

  it('offers a bounded retry from the route error boundary', () => {
    const reset = vi.fn()
    render(<ClassroomError error={new Error('database unavailable')} reset={reset} />)

    expect(screen.queryByText('database unavailable')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledOnce()
  })
})
