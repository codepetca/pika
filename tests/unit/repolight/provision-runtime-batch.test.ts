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
  vi.stubEnv('REPOLIGHT_MANAGED_ROLLOUT_MODE', 'full')
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

describe('pilot recovery scope', () => {
  const other = '33333333-3333-4333-8333-333333333333'
  it('claims only exact pilot teachers, including after an empty candidate', async () => {
    vi.stubEnv('REPOLIGHT_MANAGED_ROLLOUT_MODE', 'scoped')
    vi.stubEnv('REPOLIGHT_MANAGED_PILOT_TEACHER_IDS_JSON', JSON.stringify([other, teacherId]))
    const { rpc } = database([null, claim])
    const result = await drainRepoLightProvisionOutbox({ limit: 10 })
    expect(result).toMatchObject({ processed: 1 })
    const claims = rpc.mock.calls.filter(([, args]) => args.p_action === 'claim')
    expect(claims.map(([, args]) => args.p_payload)).toEqual([{ teacherId: other }, { teacherId }])
    expect(state.ensure).toHaveBeenCalledOnce()
  })
  it('does not create a client or claim for a nonpilot billing kick', async () => {
    vi.stubEnv('REPOLIGHT_MANAGED_ROLLOUT_MODE', 'scoped')
    vi.stubEnv('REPOLIGHT_MANAGED_PILOT_TEACHER_IDS_JSON', JSON.stringify([teacherId]))
    expect(await drainRepoLightProvisionOutbox({ teacherId: other })).toMatchObject({ processed: 0 })
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it('rejects malformed scope before creating a client', async () => {
    vi.stubEnv('REPOLIGHT_MANAGED_ROLLOUT_MODE', 'scoped')
    vi.stubEnv('REPOLIGHT_MANAGED_PILOT_TEACHER_IDS_JSON', '[]')
    await expect(drainRepoLightProvisionOutbox()).rejects.toThrow('Managed repository reports are unavailable.')
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
})

it('defaults to off before creating a database client', async () => {
  vi.stubEnv('REPOLIGHT_MANAGED_ROLLOUT_MODE', undefined)
  expect(await drainRepoLightProvisionOutbox()).toEqual({ status: 'disabled' })
  expect(getServiceRoleClient).not.toHaveBeenCalled()
})

it('rejects an empty targeted subject before claiming', async () => {
  await expect(drainRepoLightProvisionOutbox({ teacherId: '' })).rejects.toThrow('RepoLight provisioning subject is invalid')
  expect(getServiceRoleClient).not.toHaveBeenCalled()
})
