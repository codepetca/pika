import { describe, expect, it } from 'vitest'
import { buildLoginRedirectPath, getRequestPath } from '@/lib/auth-redirect'

describe('auth redirect paths', () => {
  it('preserves a safe interrupted path and query without inventing an expiry reason', () => {
    const redirectPath = buildLoginRedirectPath('/teacher/calendar?view=month')
    const url = new URL(redirectPath, 'https://pika.example')

    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('next')).toBe('/teacher/calendar?view=month')
    expect(url.searchParams.has('reason')).toBe(false)
  })

  it('includes an explicit recovery reason when one is known', () => {
    const redirectPath = buildLoginRedirectPath('/student/history', 'session-expired')
    const url = new URL(redirectPath, 'https://pika.example')

    expect(url.searchParams.get('reason')).toBe('session-expired')
  })

  it('falls back safely for canonicalized external paths', () => {
    for (const path of ['//evil.example', '/\\evil.example', '/a/..//evil.example']) {
      const url = new URL(buildLoginRedirectPath(path), 'https://pika.example')
      expect(url.searchParams.get('next')).toBe('/classrooms')
    }
  })

  it('derives only the pathname and query from a request URL', () => {
    expect(getRequestPath(new URL('https://pika.example/teacher/calendar?view=month#ignored')))
      .toBe('/teacher/calendar?view=month')
  })
})
