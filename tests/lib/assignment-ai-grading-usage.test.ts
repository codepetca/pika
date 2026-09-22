import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertAssignmentAiGradingUsageContract,
  isAssignmentAiGradingUsageMeteringEnabled,
  getAssignmentAiUsageFailureReason,
  reserveAssignmentAiGradingItemUsage,
  throwAssignmentAiUsageError,
} from '@/lib/server/assignment-ai-grading-usage'
import { AssignmentAiGradingLeaseLostError } from '@/lib/server/assignment-ai-grading-lease'

afterEach(() => vi.unstubAllEnvs())

describe('Assignment AI usage boundary', () => {
  const contract = {
    contract: 'assignment-ai-grading-usage', version: 2,
    source_fingerprint_version: 1, gradex_correlation_version: 1,
  }

  it('accepts only the complete M204 service contract', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: contract, error: null }) }
    await expect(assertAssignmentAiGradingUsageContract(supabase as never)).resolves.toBeUndefined()
    expect(supabase.rpc).toHaveBeenCalledWith('get_assignment_ai_grading_usage_contract_v2')
  })

  it.each([
    { data: null, error: { code: 'PGRST202', message: 'missing private contract' } },
    { data: { ...contract, version: 1 }, error: null },
    { data: { ...contract, unexpected: true }, error: null },
  ])('fails closed with a generic error for missing or invalid M204 evidence', async (result) => {
    const supabase = { rpc: vi.fn().mockResolvedValue(result) }
    await expect(assertAssignmentAiGradingUsageContract(supabase as never))
      .rejects.toMatchObject({ statusCode: 503, message: 'AI grading is temporarily unavailable' })
  })

  it.each([undefined, '', 'false', 'TRUE', ' true ', '1'])('is disabled for %s', (value) => {
    vi.stubEnv('ASSIGNMENT_AI_GRADING_USAGE_METERING_ENABLED', value)
    expect(isAssignmentAiGradingUsageMeteringEnabled()).toBe(false)
  })
  it('requires exact true', () => {
    vi.stubEnv('ASSIGNMENT_AI_GRADING_USAGE_METERING_ENABLED', 'true')
    expect(isAssignmentAiGradingUsageMeteringEnabled()).toBe(true)
  })
  it.each([
    { code: 'PGRST202', message: 'private schema content' },
    { code: '55000', message: 'feature_usage_entitlement_unavailable' },
    { code: '42501', message: 'feature_usage_entitlement_disabled' },
    { code: '23514', message: 'private quota error' },
    { code: '40001', message: 'metered_assignment_source_changed' },
  ])('maps $code safely', (error) => {
    expect(() => throwAssignmentAiUsageError(error)).toThrow('AI grading is temporarily unavailable')
  })
  it('recognizes only the exact quota and lease errors', () => {
    expect(() => throwAssignmentAiUsageError({ code: '23514', message: 'feature_usage_quota_exhausted' }))
      .toThrow('AI grading limit reached')
    expect(() => throwAssignmentAiUsageError({ code: '40001', message: 'Assignment AI grading lease was lost' }))
      .toThrow(AssignmentAiGradingLeaseLostError)
  })
  it.each([
    ['40001', 'metered_assignment_source_changed', 'stale'],
    ['40001', 'metered_assignment_enrollment_changed', 'stale'],
    ['40001', 'metered_assignment_binding_changed', 'stale'],
    ['55000', 'metered_assignment_archived', 'stale'],
    ['PGRST202', 'missing contract', 'internal_failure'],
    ['40001', 'private source detail', 'internal_failure'],
  ])('keeps cleanup reason private for %s/%s', (code, message, reason) => {
    try {
      throwAssignmentAiUsageError({ code, message })
    } catch (error) {
      expect(getAssignmentAiUsageFailureReason(error)).toBe(reason)
      expect(error).toMatchObject({ message: 'AI grading is temporarily unavailable' })
    }
  })
  const reservation = {
    operation_id: 'item-1', subject_user_id: 'teacher-1', feature_key: 'grading.ai',
    operation_kind: 'assignment_ai_grading', usage_ref: 'assignment-ai-item-v1:item-1',
    units: 1, status: 'reserved', expires_at: '2099-01-01T00:00:00Z',
  }
  it.each([
    { status: 'released' }, { status: 'settled' }, { units: 2 },
    { operation_id: 'other-item' }, { subject_user_id: 'other-teacher' },
    { usage_ref: 'other-ref' }, { expires_at: '2020-01-01T00:00:00Z' },
  ])('rejects unusable reservation evidence %j', async (overrides) => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { reservation: { ...reservation, ...overrides } }, error: null }) }
    await expect(reserveAssignmentAiGradingItemUsage({ supabase: supabase as never,
      itemId: 'item-1', teacherId: 'teacher-1', leaseToken: 'lease-1' }))
      .rejects.toThrow('AI grading is temporarily unavailable')
  })
  it('admits a bound unexpired reservation', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { reservation, duplicate: true }, error: null }) }
    await expect(reserveAssignmentAiGradingItemUsage({ supabase: supabase as never,
      itemId: 'item-1', teacherId: 'teacher-1', leaseToken: 'lease-1' })).resolves.toBeUndefined()
  })
})
