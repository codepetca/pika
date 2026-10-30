import { describe, expect, it, vi } from 'vitest'
import { ManagedRepoLightError } from '@/lib/server/repolight-managed'
import { deliverRepoLightProvisionOutbox } from '@/lib/server/repolight-provision-outbox'

const teacherId = '11111111-1111-4111-8111-111111111111'
const leaseToken = '22222222-2222-4222-8222-222222222222'
function setup(error?: unknown) {
  const outbox = { claim: vi.fn().mockResolvedValue({ teacherId, leaseToken, attempt: 1 }), finish: vi.fn().mockResolvedValue({ acknowledged: true }) }
  const registry = { ensure: error ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue({}) }
  return { enabled: true, outbox, registry }
}
describe('durable RepoLight subscription provisioning delivery', () => {
  it('does no work while disabled and never allocates work from a missing claim', async () => {
    const deps = setup()
    expect(await deliverRepoLightProvisionOutbox({ ...deps, enabled: false })).toEqual({ status: 'disabled' })
    expect(deps.outbox.claim).not.toHaveBeenCalled()
    deps.outbox.claim.mockResolvedValue(null)
    expect(await deliverRepoLightProvisionOutbox(deps)).toEqual({ status: 'empty' })
    expect(deps.registry.ensure).not.toHaveBeenCalled()
  })
  it('drives one claimed teacher through the current registry entitlement boundary', async () => {
    const deps = setup()
    expect(await deliverRepoLightProvisionOutbox({ ...deps, teacherId })).toEqual({ status: 'ready' })
    expect(deps.outbox.claim).toHaveBeenCalledExactlyOnceWith(teacherId)
    expect(deps.registry.ensure).toHaveBeenCalledExactlyOnceWith(teacherId)
    expect(deps.outbox.finish).toHaveBeenCalledExactlyOnceWith({ teacherId, leaseToken, outcome: 'ready' })
  })
  it.each([
    [new ManagedRepoLightError('repolight_managed_ineligible'), 'ineligible', 'repolight_managed_ineligible'],
    [new ManagedRepoLightError('repolight_managed_timeout', true), 'retry', 'repolight_managed_timeout'],
    [new ManagedRepoLightError('repolight_managed_invalid_storage'), 'failed', 'repolight_managed_invalid_storage'],
    [new Error('secret provider body must never be saved'), 'retry', 'repolight_provision_unavailable'],
  ])('records a safe durable failure outcome', async (error, outcome, errorCode) => {
    const deps = setup(error)
    expect(await deliverRepoLightProvisionOutbox(deps)).toEqual({ status: outcome })
    expect(deps.outbox.finish).toHaveBeenCalledExactlyOnceWith({ teacherId, leaseToken, outcome, errorCode })
  })
  it('does not acknowledge a stale worker after a newer billing revision', async () => {
    const deps = setup()
    deps.outbox.finish.mockResolvedValue({ acknowledged: false })
    expect(await deliverRepoLightProvisionOutbox(deps)).toEqual({ status: 'superseded' })
  })
  it('retains an uncertain delivery when storage acknowledgement fails', async () => {
    const deps = setup()
    deps.outbox.finish.mockRejectedValue(new Error('storage unavailable'))
    await expect(deliverRepoLightProvisionOutbox(deps)).rejects.toThrow('storage unavailable')
    expect(deps.registry.ensure).toHaveBeenCalledTimes(1)
  })
  it('rejects invalid or cross-account claims before provider activity', async () => {
    const deps = setup()
    await expect(deliverRepoLightProvisionOutbox({ ...deps, teacherId: leaseToken })).rejects.toThrow('claim is invalid')
    expect(deps.registry.ensure).not.toHaveBeenCalled()
    expect(deps.outbox.finish).not.toHaveBeenCalled()
  })
})
