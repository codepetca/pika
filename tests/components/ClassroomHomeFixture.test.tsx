import { afterEach, describe, expect, it, vi } from 'vitest'
import ClassroomHomeFixturePage from '@/app/e2e-fixtures/classroom-home/page'
import { ClassroomHomeFixture } from '@/app/e2e-fixtures/classroom-home/preview'
import type { ReactElement } from 'react'

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('@/app/e2e-fixtures/classroom-home/preview', () => ({ ClassroomHomeFixture: () => null }))
afterEach(() => vi.unstubAllEnvs())
describe('ClassroomHomeFixture protected production-owner composition', () => {
  it.each(['true', 'false'])('never exposes synthetic accounts in production with fixture flag %s', async flag => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PIKA_E2E_FIXTURES', flag)
    await expect(ClassroomHomeFixturePage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NOT_FOUND')
  })
  it('requires explicit fixture enablement even in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PIKA_E2E_FIXTURES', 'false')
    await expect(ClassroomHomeFixturePage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NOT_FOUND')
  })
  it.each(['teacher', 'student'])('passes only deterministic %s inputs to the real composition fixture', async role => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PIKA_E2E_FIXTURES', 'true')
    const result = await ClassroomHomeFixturePage({ searchParams: Promise.resolve({ role, state: 'hidden', creation: 'disabled' }) }) as ReactElement
    expect(result.type).toBe(ClassroomHomeFixture)
    expect(result.props).toEqual({ role, state: 'hidden', canCreate: false })
  })
})
