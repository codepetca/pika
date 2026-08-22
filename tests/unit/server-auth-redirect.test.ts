import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: mocks.headers,
}))

import { getServerLoginRedirectPath } from '@/lib/server/auth-redirect'

describe('getServerLoginRedirectPath', () => {
  beforeEach(() => {
    mocks.headers.mockReset()
  })

  it('preserves the middleware-provided path and query', () => {
    mocks.headers.mockReturnValue(
      new Headers({ 'x-pika-request-path': '/teacher/calendar?week=next' }),
    )

    expect(getServerLoginRedirectPath()).toBe(
      '/login?next=%2Fteacher%2Fcalendar%3Fweek%3Dnext',
    )
  })

  it('falls back to classrooms when middleware did not provide a path', () => {
    mocks.headers.mockReturnValue(new Headers())

    expect(getServerLoginRedirectPath()).toBe(
      '/login?next=%2Fclassrooms',
    )
  })
})
