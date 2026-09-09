import { describe, expect, it } from 'vitest'
import {
  buildAuthContinuationPath,
  buildLoginRedirectPath,
  getRequestPath,
} from '@/lib/auth-redirect'

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

  it('encodes email and a safe internal continuation', () => {
    expect(buildAuthContinuationPath('/verify-signup', {
      email: 'student@example.com',
      next: '/attendance/classroom/qr-token?source=poster',
    })).toBe(
      '/verify-signup?email=student%40example.com&next=%2Fattendance%2Fclassroom%2Fqr-token%3Fsource%3Dposter',
    )
  })

  it.each([
    '//evil.example/steal',
    '/\\evil.example/steal',
    'https://evil.example/steal',
  ])('drops unsafe continuation %s', (next) => {
    expect(buildAuthContinuationPath('/signup', { next })).toBe('/signup')
  })
})
