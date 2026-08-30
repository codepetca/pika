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

const originalGalleryFlag = process.env.ENABLE_UI_GALLERY
const originalFixtureFlag = process.env.PIKA_E2E_FIXTURES

function restoreEnv(name: 'ENABLE_UI_GALLERY' | 'PIKA_E2E_FIXTURES', value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

describe('PatternLabPage guard', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset()
    mocks.notFound.mockClear()
    mocks.redirect.mockClear()
  })

  afterEach(() => {
    restoreEnv('ENABLE_UI_GALLERY', originalGalleryFlag)
    restoreEnv('PIKA_E2E_FIXTURES', originalFixtureFlag)
  })

  it('stays unavailable unless the gallery flag is enabled', async () => {
    delete process.env.ENABLE_UI_GALLERY

    await expect(PatternLabPage({})).rejects.toThrow('not-found')
    expect(mocks.notFound).toHaveBeenCalledOnce()
  })

  it('uses an explicit deterministic role only in fixture mode', async () => {
    process.env.ENABLE_UI_GALLERY = 'true'
    process.env.PIKA_E2E_FIXTURES = 'true'

    const page = (await PatternLabPage({ searchParams: { role: 'student' } })) as ReactElement<{
      role: string
    }>

    expect(page.props.role).toBe('student')
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
  })
})
