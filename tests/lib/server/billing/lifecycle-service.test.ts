import { describe, expect, it, vi } from 'vitest'
import { applyDueBillingAccess, getBillingAccessStatus, startBillingTrial, BillingLifecycleEligibilityError } from '@/lib/server/billing/lifecycle-service'
import { createBillingLifecycleStore } from '@/lib/server/billing/lifecycle-store'

const subjectUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const operationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const status = { subject_user_id: subjectUserId, state: 'trial', plan_key: 'plus', offering_version_id: null,
  classroom_limit: 5, access_ends_at: '2026-10-27T19:00:00Z', renewal_at: null,
  can_start_paid_work: true, retryable: false, revision: 1 }
function store() {
  return { startTrial: vi.fn().mockResolvedValue(status), getAccessStatus: vi.fn().mockResolvedValue(status),
    applyDueAccess: vi.fn().mockResolvedValue({ processed: 1 }) }
}
describe('lifecycle service boundary', () => {
  it('retains the caller operation identity on a retry and never supplies a client clock', async () => {
    const db = store()
    for (let i = 0; i < 2; i++) await expect(startBillingTrial({ store: db, subjectUserId, operationId })).resolves.toEqual(status)
    expect(db.startTrial.mock.calls).toEqual([[{ subject_user_id: subjectUserId, operation_id: operationId }],
      [{ subject_user_id: subjectUserId, operation_id: operationId }]])
  })
  it('does not expose another account returned by a broken store', async () => {
    const db = store()
    db.getAccessStatus.mockResolvedValue({ ...status, subject_user_id: operationId })
    db.startTrial.mockResolvedValue({ ...status, subject_user_id: operationId })
    await expect(getBillingAccessStatus({ store: db, subjectUserId })).rejects.toThrow('unavailable')
    await expect(startBillingTrial({ store: db, subjectUserId, operationId })).rejects.toThrow('unavailable')
  })
  it.each([{ ...status, classroom_limit: -1 }, { ...status, access_ends_at: 'tomorrow' }, { ...status, can_start_paid_work: 'true' }])('fails closed on incompatible database state: %j', async bad => {
    const db = store()
    db.getAccessStatus.mockResolvedValue(bad)
    await expect(getBillingAccessStatus({ store: db, subjectUserId })).rejects.toThrow('unavailable')
  })
  it('bounds worker batch sizes and rejects an impossible completion count', async () => {
    const db = store()
    await expect(applyDueBillingAccess({ store: db, limit: 0 })).rejects.toThrow()
    await expect(applyDueBillingAccess({ store: db, limit: 101 })).rejects.toThrow()
    expect(db.applyDueAccess).not.toHaveBeenCalled()
    db.applyDueAccess.mockResolvedValue({ processed: 26 })
    await expect(applyDueBillingAccess({ store: db, limit: 25 })).rejects.toThrow()
  })
  it('maps only the named trial eligibility database error to a customer conflict', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '55000', message: 'billing_trial_ineligible' } })
    const db = createBillingLifecycleStore({ rpc })
    await expect(startBillingTrial({ store: db, subjectUserId, operationId })).rejects.toBeInstanceOf(BillingLifecycleEligibilityError)
    rpc.mockResolvedValue({ data: null, error: { code: '55000', message: 'private provider detail' } })
    await expect(startBillingTrial({ store: db, subjectUserId, operationId })).rejects.toThrow('Billing lifecycle database operation failed')
  })
  it('keeps private database/provider errors out of status responses', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'private provider detail' } })
    await expect(getBillingAccessStatus({ store: createBillingLifecycleStore({ rpc }), subjectUserId }))
      .rejects.toThrow('Billing lifecycle database operation failed')
  })
})
