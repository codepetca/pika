import { describe, expect, it } from 'vitest'
import {
  SESSION_CHANGED_REASON,
  SESSION_EXPIRED_REASON,
  buildLoginRedirectPath,
  getSafeInternalPath,
} from '@/lib/client-auth'

describe('client auth recovery', () => {
  it('preserves the interrupted route and identifies session expiry', () => {
    const redirectPath = buildLoginRedirectPath('/teacher/calendar?view=month')
    const url = new URL(redirectPath, 'https://pika.example')

    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('next')).toBe('/teacher/calendar?view=month')
    expect(url.searchParams.get('reason')).toBe(SESSION_EXPIRED_REASON)
  })

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/%5Cevil.example',
    '/a/..//evil.example',
    '/%2e%2e//evil.example',
  ])(
    'falls back to classrooms for an unsafe return path: %s',
    (unsafePath) => {
      const redirectPath = buildLoginRedirectPath(unsafePath)
      const url = new URL(redirectPath, 'https://pika.example')

      expect(url.searchParams.get('next')).toBe('/classrooms')
      expect(url.searchParams.get('reason')).toBe(SESSION_EXPIRED_REASON)
    },
  )

  it('identifies an account change separately from session expiry', () => {
    const redirectPath = buildLoginRedirectPath('/teacher/calendar', SESSION_CHANGED_REASON)
    const url = new URL(redirectPath, 'https://pika.example')

    expect(url.searchParams.get('reason')).toBe(SESSION_CHANGED_REASON)
  })

  it('canonicalizes safe internal paths without changing their query or hash', () => {
    expect(getSafeInternalPath('/student/history?month=8#entry-1'))
      .toBe('/student/history?month=8#entry-1')
  })
})
