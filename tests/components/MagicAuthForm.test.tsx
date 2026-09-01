import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MagicAuthForm } from '@/components/auth/MagicAuthForm'

const mockNavigateTo = vi.hoisted(() => vi.fn())
vi.mock('@/lib/client-navigation', () => ({ navigateTo: mockNavigateTo }))

describe('MagicAuthForm', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    mockNavigateTo.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('requires a school email without showing a required marker', () => {
    render(<MagicAuthForm intent="sign-in" />)

    expect(screen.getByLabelText(/school email/i)).toBeRequired()
    expect(screen.getByText('School Email')).not.toHaveTextContent('*')
  })

  it('stays on Pika while moving from email to six-digit code', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    })
    const user = userEvent.setup()
    render(<MagicAuthForm intent="sign-in" nextPath="/attendance/check-in/token-123" />)

    await user.type(screen.getByLabelText(/school email/i), 'Student@Example.com')
    await user.click(screen.getByRole('button', { name: /email me a sign-in code/i }))

    await waitFor(() => expect(screen.getByLabelText(/six-digit code/i)).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/workos/magic/start', expect.objectContaining({
      body: JSON.stringify({
        email: 'Student@Example.com',
        intent: 'sign-in',
        next: '/attendance/check-in/token-123',
      }),
    }))
    expect(screen.getByText('The code expires in 10 minutes.')).toBeInTheDocument()
  })

  it('submits only six digits and follows the server-approved Pika path', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ redirectUrl: '/classrooms' }) })
    const user = userEvent.setup()
    render(<MagicAuthForm intent="sign-up" initialEmail="student@example.com" />)

    await user.click(screen.getByRole('button', { name: /email me a sign-in code/i }))
    const codeInput = await screen.findByLabelText(/six-digit code/i)
    await user.type(codeInput, '12a3456')
    expect(codeInput).toHaveValue('123456')
    await user.click(screen.getByRole('button', { name: /verify and create account/i }))

    await waitFor(() => expect(mockNavigateTo).toHaveBeenCalledWith('/classrooms'))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/workos/magic/verify', expect.objectContaining({
      body: JSON.stringify({ code: '123456' }),
    }))
  })

  it('shows invalid-code errors without leaving the code step', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Invalid or expired code' }) })
    const user = userEvent.setup()
    render(<MagicAuthForm intent="sign-in" initialEmail="student@example.com" />)

    await user.click(screen.getByRole('button', { name: /email me a sign-in code/i }))
    await user.type(await screen.findByLabelText(/six-digit code/i), '123456')
    await user.click(screen.getByRole('button', { name: /verify and login/i }))

    expect(await screen.findByText('Invalid or expired code')).toBeInTheDocument()
    expect(screen.getByLabelText(/six-digit code/i)).toBeInTheDocument()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('restores an active server-side challenge without requesting another code', () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>

    render(<MagicAuthForm intent="sign-in" hasPendingChallenge />)

    expect(screen.getByLabelText(/six-digit code/i)).toBeInTheDocument()
    expect(screen.getByText(/sent a six-digit code to your email/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears the server-side challenge before changing email', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({ ok: true })
    const user = userEvent.setup()
    render(<MagicAuthForm intent="sign-in" hasPendingChallenge />)

    await user.click(screen.getByRole('button', { name: /use a different email/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/workos/magic/pending',
      { method: 'DELETE' },
    ))
    expect(screen.getByLabelText(/school email/i)).toBeInTheDocument()
  })
})
