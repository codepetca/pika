import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignupClient } from '@/app/signup/SignupClient'

const { mockGet, mockPush } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPush: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: mockGet }),
}))

describe('SignupClient', () => {
  beforeEach(() => {
    mockGet.mockReturnValue(null)
    mockPush.mockClear()
  })

  afterEach(cleanup)

  it('defaults to WorkOS email-code signup without password-era steps', () => {
    render(<SignupClient />)

    expect(screen.getByRole('button', { name: /email me a sign-in code/i })).toBeInTheDocument()
    expect(screen.getByText(/six-digit code/i)).toBeInTheDocument()
    expect(screen.queryByText(/create your password/i)).not.toBeInTheDocument()
  })

  it('renders the legacy signup start only with the explicit override', () => {
    render(<SignupClient legacyPasswordAuthEnabled />)

    expect(screen.getByRole('button', { name: /send verification code/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /email me a sign-in code/i })).not.toBeInTheDocument()
  })
})
