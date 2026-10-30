import { afterEach, describe, expect, it, vi } from 'vitest'
import { getServiceRoleClient } from '@/lib/supabase'
import { attemptRepoLightProvisionOutbox, drainRepoLightProvisionOutbox } from '@/lib/server/repolight-provision-runtime'
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
describe('RepoLight provisioning runtime gates', () => {
  it.each([undefined, 'false', 'TRUE', 'invalid'])('performs no storage or key access unless explicitly enabled', async enabled => {
    vi.stubEnv('PIKA_REPOLIGHT_MANAGED_ENABLED', enabled)
    expect(await drainRepoLightProvisionOutbox()).toEqual({ status: 'disabled' })
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it('retains the billing success when configuration is missing', async () => {
    vi.stubEnv('PIKA_REPOLIGHT_MANAGED_ENABLED', 'true')
    vi.stubEnv('REPOLIGHT_MANAGED_ENCRYPTION_KEYS_JSON', undefined)
    expect(await attemptRepoLightProvisionOutbox()).toEqual({ status: 'pending' })
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
})
