import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { drainRepoLightProvisionOutbox } from '@/lib/server/repolight-provision-runtime'
import { getServiceRoleClient } from '@/lib/supabase'
const state = vi.hoisted(() => ({ ensure: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/repolight-managed-database', () => ({ createManagedRepoLightDatabase: vi.fn(() => ({})) }))
vi.mock('@/lib/server/repolight-managed', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/repolight-managed')>(),
  createManagedRepoLightRegistry: vi.fn(() => ({ ensure: state.ensure })),
}))
const teacherId = '11111111-1111-4111-8111-111111111111'
const claim = { teacherId, leaseToken: '22222222-2222-4222-8222-222222222222', attempt: 1 }
beforeEach(() => {
  state.ensure.mockResolvedValue({})
  vi.stubEnv('PIKA_REPOLIGHT_MANAGED_ENABLED', 'true')
  vi.stubEnv('REPOLIGHT_API_URL', 'https://repolight.example')
  vi.stubEnv('REPOLIGHT_MANAGED_INSTALLATION_REF', 'fixture')
  vi.stubEnv('REPOLIGHT_MANAGED_CONTROL_SECRET', Buffer.alloc(32, 1).toString('base64url'))
  vi.stubEnv('REPOLIGHT_MANAGED_ACTIVE_ENCRYPTION_KEY_ID', 'fixture')
  vi.stubEnv('REPOLIGHT_MANAGED_ENCRYPTION_KEYS_JSON', JSON.stringify({ fixture: Buffer.alloc(32, 2).toString('base64url') }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.restoreAllMocks() })
function database(claims: unknown[]) {
  const actions: string[] = []
  const rpc = vi.fn((_name: string, args: { p_action: string; p_payload: unknown }) => {
    actions.push(args.p_action)
    return { abortSignal: vi.fn().mockResolvedValue({ error: null, data: args.p_action === 'claim' ? claims.shift() ?? null : { acknowledged: true } }) }
  })
  vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getServiceRoleClient>)
  return { actions, rpc }
}
describe('bounded sequential RepoLight recovery batch', () => {
  it('drains at most ten claims sequentially and reports remaining batch pressure', async () => {
    const { actions } = database(Array(12).fill(claim))
    const result = await drainRepoLightProvisionOutbox({ limit: 10 })
    expect(result).toMatchObject({ status: 'ok', processed: 10, outcomes: { ready: 10 }, stoppedReason: 'batch_limit' })
    expect(actions).toEqual(Array.from({ length: 10 }, () => ['claim', 'finish']).flat())
  })
  it('stops when the queue is empty', async () => {
    database([claim])
    expect(await drainRepoLightProvisionOutbox({ limit: 10 })).toMatchObject({ processed: 1, stoppedReason: 'empty' })
  })
  it('stops starting claims with less than ten seconds left in the delivery budget', async () => {
    const { actions } = database([claim, claim])
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    state.ensure.mockImplementation(async () => { now += 31_000 })
    expect(await drainRepoLightProvisionOutbox({ limit: 10 })).toMatchObject({ processed: 1, stoppedReason: 'time_limit' })
    expect(actions).toEqual(['claim', 'finish'])
  })
})
