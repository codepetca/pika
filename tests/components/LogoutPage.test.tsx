import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LogoutPage from '@/app/logout/page'

describe('LogoutPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requires explicit activation of the same-origin POST', () => {
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, 'requestSubmit')
      .mockImplementation(() => {})

    render(<LogoutPage />)

    const button = screen.getByRole('button', { name: 'Sign out' })
    expect(button).toHaveClass('min-h-control')
    const form = button.closest('form')
    expect(form).toHaveAttribute('action', '/api/auth/workos/logout')
    expect(form).toHaveAttribute('method', 'post')
    expect(screen.getByRole('status')).toHaveTextContent('Ready to sign you out.')
    expect(requestSubmit).not.toHaveBeenCalled()
  })
})
