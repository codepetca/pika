import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClassroomsReadError } from '@/app/classrooms/ClassroomsReadError'
import { TooltipProvider } from '@/ui'

const mocks = vi.hoisted(() => ({ pending: false, start: vi.fn(), refresh: vi.fn() }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useTransition: () => [mocks.pending, mocks.start],
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

describe('classroom first-read retry', () => {
  beforeEach(() => {
    mocks.pending = false
    mocks.start.mockReset()
    mocks.refresh.mockReset()
  })
  it('blocks duplicate attempts before pending renders, disables while pending, and permits another attempt', () => {
    const view = () => <TooltipProvider><ClassroomsReadError /></TooltipProvider>
    const { rerender } = render(view())
    const button = screen.getByRole('button', { name: 'Try loading classrooms again' })
    button.focus()
    expect(button).toHaveFocus()
    fireEvent.click(button)
    fireEvent.click(button)
    expect(mocks.start).toHaveBeenCalledOnce()
    act(() => mocks.start.mock.calls[0][0]())
    expect(mocks.refresh).toHaveBeenCalledOnce()
    mocks.pending = true
    rerender(view())
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(mocks.start).toHaveBeenCalledOnce()
    mocks.pending = false
    rerender(view())
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(mocks.start).toHaveBeenCalledTimes(2)
  })
})
