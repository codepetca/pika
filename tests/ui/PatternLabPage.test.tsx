import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('not-found')
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
}))

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}))

vi.mock('@/lib/auth', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/lib/server/auth-redirect', () => ({
  getServerLoginRedirectPath: () => '/login',
}))

import PatternLabPage from '@/app/pattern-lab/page'
import UiGalleryPage from '@/app/ui-gallery/page'

const originalGalleryFlag = process.env.ENABLE_UI_GALLERY
const originalFixtureFlag = process.env.PIKA_E2E_FIXTURES
const originalNodeEnv = process.env.NODE_ENV

function restoreEnv(
  name: 'ENABLE_UI_GALLERY' | 'PIKA_E2E_FIXTURES' | 'NODE_ENV',
  value: string | undefined,
) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

describe('PatternLabPage guard', () => {
  it('keeps the merged gallery URL on the same guarded owner', () => {
    expect(UiGalleryPage).toBe(PatternLabPage)
  })

  beforeEach(() => {
    mocks.getCurrentUser.mockReset()
    mocks.notFound.mockClear()
    mocks.redirect.mockClear()
  })

  afterEach(() => {
    restoreEnv('ENABLE_UI_GALLERY', originalGalleryFlag)
    restoreEnv('PIKA_E2E_FIXTURES', originalFixtureFlag)
    restoreEnv('NODE_ENV', originalNodeEnv)
  })

  it('stays unavailable unless the gallery flag is enabled', async () => {
    delete process.env.ENABLE_UI_GALLERY

    await expect(PatternLabPage({})).rejects.toThrow('not-found')
    expect(mocks.notFound).toHaveBeenCalledOnce()
  })

  it('uses an explicit deterministic role in fixture mode', async () => {
    process.env.NODE_ENV = 'test'
    process.env.ENABLE_UI_GALLERY = 'true'
    process.env.PIKA_E2E_FIXTURES = 'true'

    const page = (await PatternLabPage({
      searchParams: Promise.resolve({ role: 'student' }),
    })) as ReactElement<{ role: string }>

    expect(page.props.role).toBe('student')
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
  })

  it('allows an authenticated reviewer to inspect either role', async () => {
    process.env.NODE_ENV = 'test'
    process.env.ENABLE_UI_GALLERY = 'true'
    delete process.env.PIKA_E2E_FIXTURES
    mocks.getCurrentUser.mockResolvedValue({ id: 'teacher-1', role: 'teacher' })

    const page = (await PatternLabPage({
      searchParams: Promise.resolve({ role: 'student' }),
    })) as ReactElement<{ role: string }>

    expect(page.props.role).toBe('student')
    expect(mocks.getCurrentUser).toHaveBeenCalledOnce()
  })

  it('rejects production even when gallery and fixture flags are enabled', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ENABLE_UI_GALLERY = 'true'
    process.env.PIKA_E2E_FIXTURES = 'true'

    await expect(
      PatternLabPage({ searchParams: Promise.resolve({ role: 'student' }) }),
    ).rejects.toThrow('not-found')
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
  })

  it('redirects an unauthenticated visitor outside fixture mode', async () => {
    process.env.NODE_ENV = 'test'
    process.env.ENABLE_UI_GALLERY = 'true'
    delete process.env.PIKA_E2E_FIXTURES
    mocks.getCurrentUser.mockResolvedValue(null)

    await expect(PatternLabPage({})).rejects.toThrow('redirect:/login')
  })
})
