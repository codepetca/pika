import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LogoutPage from '@/app/logout/page'

describe('LogoutPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('submits a same-origin POST and keeps an accessible manual fallback', async () => {
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, 'requestSubmit')
      .mockImplementation(() => {})

    render(<LogoutPage />)

    const button = screen.getByRole('button', { name: 'Continue signing out' })
    const form = button.closest('form')
    expect(form).toHaveAttribute('action', '/api/auth/workos/logout')
    expect(form).toHaveAttribute('method', 'post')
    expect(screen.getByRole('status')).toHaveTextContent('Signing you out…')
    await waitFor(() => expect(requestSubmit).toHaveBeenCalledOnce())
  })
})
