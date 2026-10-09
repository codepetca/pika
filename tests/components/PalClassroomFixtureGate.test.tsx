import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('@/app/e2e-fixtures/pal-classroom/preview', () => ({ PalClassroomFixture: () => null }))
import PalClassroomFixturePage from '@/app/e2e-fixtures/pal-classroom/page'

afterEach(() => vi.unstubAllEnvs())

describe('PalClassroomFixture verification-only recovery gate', () => {
  it.each([['production', 'true'], ['development', 'false'], ['development', undefined]])(
    'rejects fixture in environment=%s flag=%s even with recovery requested', async (environment, flag) => {
      vi.stubEnv('NODE_ENV', environment)
      vi.stubEnv('PIKA_E2E_FIXTURES', flag)
      await expect(PalClassroomFixturePage({ searchParams: Promise.resolve({ recovery: 'true' }) }))
        .rejects.toThrow('NOT_FOUND')
    },
  )

  it.each([[undefined, false], ['false', false], ['true', true]])(
    'opts into recovery controls only for explicit recovery=%s', async (recovery, enabled) => {
      vi.stubEnv('NODE_ENV', 'development')
      vi.stubEnv('PIKA_E2E_FIXTURES', 'true')
      const element = await PalClassroomFixturePage({ searchParams: Promise.resolve({ recovery }) })
      expect(element.props.recoveryEnabled).toBe(enabled)
    },
  )
})
