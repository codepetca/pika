import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), provision: vi.fn(), logError: vi.fn(), email: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('@/lib/server/billing/email-notices', () => ({ processLiveBillingEmailNotices: mocks.email }))
vi.mock('@/lib/server/repolight-provision-runtime', () => ({ attemptRepoLightProvisionOutbox: mocks.provision }))
vi.mock('@/lib/server/diagnostics', () => ({ logServerError: mocks.logError }))

import { processLiveTrialLifecycle } from '@/lib/server/billing/lifecycle-runtime'

const projectRef = 'zhioqbapgfcrronyuidm'
const config = {
  projectRef, stripeAccount: 'acct_LiveTrialFixture', supabaseOrigin: `https://${projectRef}.supabase.co`,
  appOrigin: 'https://pika.codepet.ca', workerSecret: 'unused-by-runtime', admissionEnabled: false,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.rpc.mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ data: { processed: 1 }, error: null })
  mocks.logError.mockReturnValue('fixture-diagnostic')
})

describe('live trial recovery worker', () => {
  it.each([
    { data: null, error: { code: 'XX000', message: 'private fixture detail' } },
    { data: { invalid: true }, error: null },
  ])('drains RepoLight after a due-assignment list failure', async reply => {
    mocks.rpc.mockResolvedValueOnce(reply)

    await expect(processLiveTrialLifecycle(config)).resolves.toEqual({
      lifecycle: { processed: 1 }, assignmentReleases: { failed: 1, diagnosticId: 'fixture-diagnostic' },
    })
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      'billing_live_trial_lifecycle_ready_v1', 'billing_apply_due_live_trial_access_v1',
      'list_due_billing_assignment_releases_v1',
    ])
    expect(mocks.rpc).toHaveBeenCalledBefore(mocks.provision)
    expect(mocks.provision).toHaveBeenCalledExactlyOnceWith({ client: { rpc: mocks.rpc } })
  })

  it('drains email notices after applying trial access and returns the lane receipt', async () => {
    const emailNotices = { processed: 1, sent: 1, attention: 0 }
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000' } })
    mocks.email.mockResolvedValueOnce(emailNotices)
    await expect(processLiveTrialLifecycle(config)).resolves.toMatchObject({ emailNotices })
    expect(mocks.email).toHaveBeenCalledExactlyOnceWith({ rpc: mocks.rpc }, config)
    expect(mocks.provision).toHaveBeenCalledBefore(mocks.email)
  })
})
