import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PatternLabPage from '@/app/pattern-lab/page'

const { getCurrentUser, notFound } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  notFound: vi.fn(() => { throw new Error('not found') }),
}))
vi.mock('@/lib/auth', () => ({ getCurrentUser }))
vi.mock('@/lib/server/auth-redirect', () => ({ getServerLoginRedirectPath: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound, redirect: vi.fn() }))
vi.mock('@/app/__ui/UiGallery', () => ({
  UiGallery: ({ assignmentControllerFixture = false, testControllerFixture = false, createClassroomControllerFixture = false }: { assignmentControllerFixture?: boolean; testControllerFixture?: boolean; createClassroomControllerFixture?: boolean }) => (
    <div data-testid="gallery" data-controller-fixture={String(assignmentControllerFixture)} data-test-controller-fixture={String(testControllerFixture)} data-classroom-controller-fixture={String(createClassroomControllerFixture)} />
  ),
}))

describe('PatternLabPage controlled authoring fixture gates', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ENABLE_UI_GALLERY', 'true')
    getCurrentUser.mockResolvedValue({ role: 'teacher' })
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

  it.each(['assignment-controller', 'test-controller', 'create-classroom-controller'])('ignores %s outside explicit E2E mode', async fixture => {
    vi.stubEnv('PIKA_E2E_FIXTURES', 'false')
    render(await PatternLabPage({ searchParams: Promise.resolve({ fixture }) }))
    expect(screen.getByTestId('gallery')).toHaveAttribute('data-controller-fixture', 'false')
    expect(screen.getByTestId('gallery')).toHaveAttribute('data-test-controller-fixture', 'false')
    expect(screen.getByTestId('gallery')).toHaveAttribute('data-classroom-controller-fixture', 'false')
    expect(getCurrentUser).toHaveBeenCalledOnce()
  })

  it.each([undefined, 'other', 'assignment-controller', 'test-controller', 'create-classroom-controller'])('requires the exact fixture marker %s in E2E mode', async fixture => {
    vi.stubEnv('PIKA_E2E_FIXTURES', 'true')
    render(await PatternLabPage({ searchParams: Promise.resolve({ role: 'teacher', fixture }) }))
    expect(screen.getByTestId('gallery')).toHaveAttribute('data-controller-fixture', String(fixture === 'assignment-controller'))
    expect(screen.getByTestId('gallery')).toHaveAttribute('data-test-controller-fixture', String(fixture === 'test-controller'))
    expect(screen.getByTestId('gallery')).toHaveAttribute('data-classroom-controller-fixture', String(fixture === 'create-classroom-controller'))
    expect(getCurrentUser).not.toHaveBeenCalled()
  })

  it.each(['assignment-controller', 'test-controller', 'create-classroom-controller'])('preserves the production route exclusion for %s even with both fixture flags', async fixture => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PIKA_E2E_FIXTURES', 'true')
    await expect(PatternLabPage({ searchParams: Promise.resolve({ fixture }) })).rejects.toThrow('not found')
    expect(notFound).toHaveBeenCalledOnce()
    expect(getCurrentUser).not.toHaveBeenCalled()
  })
})
