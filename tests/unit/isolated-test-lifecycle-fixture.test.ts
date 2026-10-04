import { afterEach, describe, expect, it, vi } from 'vitest'

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient }))
import { createIsolatedLifecycleFixture } from '../../e2e/helpers/isolated-test-lifecycle'

afterEach(() => {
  vi.unstubAllEnvs()
  createClient.mockReset()
})

describe('isolated lifecycle fixture admission', () => {
  it('makes no DB client during import or without explicit fixture opt-in', async () => {
    expect(createClient).not.toHaveBeenCalled()
    vi.stubEnv('PIKA_E2E_LIFECYCLE_FIXTURES', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'test-only-placeholder')
    await expect(createIsolatedLifecycleFixture()).rejects.toThrow('explicit local fixture opt-in')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('rejects hosted endpoints before constructing a client even with fixture opt-in', async () => {
    vi.stubEnv('PIKA_E2E_LIFECYCLE_FIXTURES', 'true')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'test-only-placeholder')
    await expect(createIsolatedLifecycleFixture()).rejects.toThrow('loopback Supabase endpoint')
    expect(createClient).not.toHaveBeenCalled()
  })
})
