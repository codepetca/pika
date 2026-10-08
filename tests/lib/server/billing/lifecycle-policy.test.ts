import { describe, expect, it } from 'vitest'
import { resolveBillingAccess } from '@/lib/server/billing/lifecycle-policy'

const base = {
  subject_user_id: '22222222-2222-4222-8222-222222222222',
  source: 'paid' as const,
  plan_key: 'plus' as const,
  offering_version_id: '44444444-4444-4444-8444-444444444444',
  classroom_limit: 5,
  starts_at: '2026-03-01T16:30:00.000Z',
  paid_through: '2026-03-08T16:30:00.000Z',
  access_ends_at: '2026-03-08T16:30:00.000Z',
  end_reason: 'renewal_pending' as const,
  revision: 2,
  assignment_matches: true,
}

describe('exact billing access', () => {
  it('retains purchased terms up to the instant and marks unknown renewal pending at the boundary', () => {
    expect(resolveBillingAccess(base, '2026-03-08T16:29:59.999Z')).toMatchObject({ state: 'paid', classroom_limit: 5, can_start_paid_work: true })
    expect(resolveBillingAccess(base, base.access_ends_at)).toMatchObject({ state: 'synchronization_pending', plan_key: 'plus', can_start_paid_work: false, retryable: true })
  })
  it.each(['trial', 'cancellation', 'renewal_grace'] as const)('ends known %s access at its exact cutoff without provider availability', end_reason => {
    const facts = { ...base, source: end_reason === 'trial' ? 'trial' as const : 'paid' as const, end_reason }
    expect(resolveBillingAccess(facts, base.access_ends_at)).toMatchObject({ state: 'free', plan_key: 'free', classroom_limit: 0, can_start_paid_work: false, retryable: false })
  })
  it('keeps the trial local and does not require provider facts', () => {
    expect(resolveBillingAccess({ ...base, source: 'trial', end_reason: 'trial', paid_through: null }, '2026-03-02T16:30:00.000Z')).toMatchObject({ state: 'trial', can_start_paid_work: true })
  })
  it('reports grace only after the previously paid term', () => {
    const facts = { ...base, end_reason: 'renewal_grace' as const, access_ends_at: '2026-03-15T16:30:00.000Z' }
    expect(resolveBillingAccess(facts, '2026-03-08T16:29:59.999Z').state).toBe('paid')
    expect(resolveBillingAccess(facts, '2026-03-08T16:30:00.000Z').state).toBe('renewal_grace')
    expect(resolveBillingAccess(facts, facts.access_ends_at).state).toBe('free')
  })
  it('never silently overwrites a drifted assignment', () => {
    expect(resolveBillingAccess({ ...base, assignment_matches: false }, '2026-03-02T16:30:00.000Z')).toMatchObject({ state: 'synchronization_pending', can_start_paid_work: false, retryable: true })
  })
  it('rejects malformed facts and untrusted time', () => {
    expect(() => resolveBillingAccess({ ...base, access_ends_at: null }, base.starts_at)).toThrow()
    expect(() => resolveBillingAccess(base, 'tomorrow')).toThrow()
  })
})
