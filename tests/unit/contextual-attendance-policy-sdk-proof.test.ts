import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAttendancePolicySdkProof, assertAttendancePolicyProofReceipt, type AttendancePolicyProofControls } from '../../scripts/contextual-attendance-policy-sdk-proof'
import { attendancePolicySdkInventory, attendancePolicySqlDescriptors, newAttendancePolicyFixture, type AttendancePolicySqlDescriptor } from '../../scripts/contextual-attendance-policy-native-fixture'

describe('attendance policy SDK leaf (CPU only)', () => {
  const f = newAttendancePolicyFixture('assignmentlist_012345abcdef'), calls = attendancePolicySdkInventory(f)
  const target = { origin: 'http://127.0.0.1:54331', serviceRoleKey: 'synthetic-service-role-key' }
  beforeEach(() => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'true')
    vi.stubEnv('PIKA_BARA_ATTENDANCE_SCOPE_MODE', 'teacher_entitlements')
    vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL', 'http://127.0.0.1:9')
    vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF', 'pika-attendance-policy-proof')
    vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET', 'pika-attendance-policy-proof-synthetic-secret-v1')
  })
  afterEach(() => vi.unstubAllEnvs())
  function harness(alter?: (data: Record<string, unknown>, n: number) => unknown, response?: () => Response) {
    const events: string[] = []; let n = 0, active = 0, max = 0
    const original: typeof fetch = vi.fn(async (url, init) => {
      expect(url).toBe(`${target.origin}/rest/v1/rpc/read_attendance_policy_for_owner_v1`)
      expect(init?.redirect).toBe('error')
      const call = calls[n], index = n++
      expect(JSON.parse(String(init?.body))).toEqual(call.args)
      events.push(`http:${call.label}`)
      const data = { actor_id: call.args.p_actor_id, classroom_id: call.args.p_classroom_id, scope_mode: call.args.p_scope_mode,
        status: call.status, policy: call.policy ? f.policy : null }
      return response?.() ?? new Response(JSON.stringify(alter ? alter(data, index) : data), { headers: { 'content-type': 'application/json' } })
    })
    const controls: AttendancePolicyProofControls = {
      deadline: Date.now() + 30000, cleanupDeadline: Date.now() + 50000,
      guard: async () => { events.push('guard') }, account: vi.fn(),
      httpSession: value => { active += value ? 1 : -1; max = Math.max(max, active) },
      sql: async (frame: AttendancePolicySqlDescriptor) => {
        events.push(`sql:${frame.name}`)
        if (frame.name === 'witness') return { studentOwner: true, selfEnrollment: true, membershipGenerationRows: 2, policyRows: 1, nativeVerified: false }
        if (frame.name === 'preservation') return { sourcePreserved: true, originalsPreserved: true, nativeVerified: false }
        return { stage: frame.name, nativeVerified: false }
      },
    }
    return { proof: createAttendancePolicySdkProof(f, target, original, controls), original, controls, events, active: () => active, maximum: () => max }
  }
  it('construction is inert; complete sequential run uses actual adapter and real SDK code', async () => {
    const h = harness(); expect(h.original).not.toHaveBeenCalled(); expect(h.events).toEqual([])
    const receipt = await h.proof.sdk(); await h.proof.settle()
    expect(receipt).toMatchObject({ complete: true, nativeVerified: false, requests: 16, adapterRequests: 13, rpcRequests: 3,
      descriptorCalls: 7, restoreState: 'restored', failed: false, poisoned: false, sessions: 0, unsettled: 0 })
    expect(h.active()).toBe(0); expect(h.maximum()).toBe(1)
    expect(receipt.physical.map(p => p.label)).toEqual(calls.map(c => c.label))
    expect(h.events.indexOf('sql:entitlement-expired')).toBeLessThan(h.events.indexOf('http:expired-entitlement'))
    expect(h.events.indexOf('sql:restore-baseline')).toBeLessThan(h.events.indexOf('http:restored-owner-policy'))
    expect(() => assertAttendancePolicyProofReceipt({ ...receipt, requests: 17 })).toThrow()
    expect(() => assertAttendancePolicyProofReceipt({ ...receipt, physical: receipt.physical.slice(1) })).toThrow()
    expect(() => assertAttendancePolicyProofReceipt({ ...receipt, nativeVerified: true })).toThrow()
  })
  it.each(['actor_id', 'classroom_id', 'scope_mode'])('rejects wrong response identity %s and closes the stream', async field => {
    const h = harness(data => ({ ...data, [field]: field === 'scope_mode' ? 'exact_canary' : f.actors[3].id }))
    await expect(h.proof.sdk()).rejects.toThrow(/^attendance_policy_proof_refused$/)
    await h.proof.settle(); expect(h.active()).toBe(0); expect(h.original).toHaveBeenCalledTimes(1)
    expect(h.proof.receipt()).toMatchObject({ failed: true, complete: false, nativeVerified: false })
  })
  it('rejects canonical row drift and denied envelopes containing a policy', async () => {
    for (const alter of [
      (data: Record<string, unknown>) => ({ ...data, policy: { ...f.policy, policy_revision: 8 } }),
      (data: Record<string, unknown>, n: number) => n === 2 ? { ...data, policy: f.policy } : data,
    ]) {
      const h = harness(alter); await expect(h.proof.sdk()).rejects.toThrow(/^attendance_policy_proof_refused$/)
      await h.proof.settle(); expect(h.active()).toBe(0)
    }
  })
  it.each([503, 302])('rejects unexpected HTTP %s without surfacing private errors', async status => {
    const h = harness(undefined, () => new Response('private-secret-error', { status, headers: { 'content-type': 'application/json' } }))
    await expect(h.proof.sdk()).rejects.toThrow(/^attendance_policy_proof_refused$/)
    await h.proof.settle(); expect(h.active()).toBe(0)
  })
  it('rejects oversize bodies, unknown JSON keys and non-JSON replies', async () => {
    const cases = [() => new Response('x'.repeat(16385), { headers: { 'content-type': 'application/json' } }),
      () => new Response('{}', { headers: { 'content-type': 'text/plain' } })]
    for (const response of cases) {
      const h = harness(undefined, response); await expect(h.proof.sdk()).rejects.toThrow(/^attendance_policy_proof_refused$/)
      await h.proof.settle(); expect(h.active()).toBe(0)
    }
    const h = harness(data => ({ ...data, private: 'withheld' })); await expect(h.proof.sdk()).rejects.toThrow(/^attendance_policy_proof_refused$/); await h.proof.settle()
  })
  it('wrong outer scope causes no physical HTTP dispatch', async () => {
    vi.stubEnv('PIKA_BARA_ATTENDANCE_SCOPE_MODE', 'exact_canary')
    const h = harness(); await expect(h.proof.sdk()).rejects.toThrow(/^attendance_policy_proof_refused$/)
    expect(h.original).not.toHaveBeenCalled(); await h.proof.settle()
  })
  it('refuses replay without another dispatch and retains finite request evidence', async () => {
    const h = harness(); await h.proof.sdk()
    await expect(h.proof.sdk()).rejects.toThrow(/^attendance_policy_proof_refused$/)
    await h.proof.settle(); expect(h.original).toHaveBeenCalledTimes(16)
    expect(h.proof.receipt()).toMatchObject({ complete: false, failed: true, requests: 16, nativeVerified: false })
  })
  it('rejects false preservation evidence', async () => {
    const h = harness(); const sql = h.controls.sql
    const controls = { ...h.controls, sql: async (frame: AttendancePolicySqlDescriptor) => frame.name === 'preservation'
      ? { sourcePreserved: true, originalsPreserved: false, nativeVerified: false } : sql(frame) }
    const proof = createAttendancePolicySdkProof(f, target, h.original, controls)
    await expect(proof.sdk()).rejects.toThrow(/^attendance_policy_proof_refused$/); await proof.settle()
    expect(proof.receipt().complete).toBe(false)
  })
  it.each([0, 1, 3])('rejects incomplete or extra correctly bound membership generation witness count %s', async count => {
    const h = harness(), baseSql = h.controls.sql
    const proof = createAttendancePolicySdkProof(f, target, h.original, { ...h.controls,
      sql: async frame => frame.name === 'witness'
        ? { studentOwner: true, selfEnrollment: true, membershipGenerationRows: count, policyRows: 1, nativeVerified: false }
        : baseSql(frame),
    })
    await expect(proof.sdk()).rejects.toThrow(/^attendance_policy_proof_refused$/)
    await proof.settle(); expect(proof.receipt().complete).toBe(false)
  })
  // CPU source-plan oracle only: evaluate the complete-row table projections
  // actually admitted by the closed descriptor. PostgreSQL/trigger execution
  // remains the outer native proof. Omitting one table makes these tests RED.
  function projectedRows(sql: string, rows: Record<string, unknown[]>, untargeted: boolean) {
    const projection: Record<string, unknown[]> = {}
    for (const match of sql.matchAll(/from ((?:public|private)\.[a-z_]+) r where (not )?\(/g)) {
      if (Boolean(match[2]) === untargeted) projection[match[1]] = rows[match[1]] ?? []
    }
    return projection
  }
  it.each(['state', 'pal_reference', 'scope_digest'] as const)(
    'rejects complete-generation %s drift in the synthetic graph and untargeted complement', async field => {
      for (const untargeted of [false, true]) {
        const h = harness(), baseSql = h.controls.sql
        const row = { generation_id: untargeted ? f.actors[4].id : f.enrollments[0].id,
          state: 'active', pal_reference: `pika-membership-v1-${'a'.repeat(32)}`, scope_digest: 'b'.repeat(64) }
        const baseline = { 'private.pal_membership_generations': [row] }
        const changed = { 'private.pal_membership_generations': [{ ...row, [field]: field === 'state' ? 'removed'
          : field === 'pal_reference' ? `pika-membership-v1-${'c'.repeat(32)}` : 'd'.repeat(64) }] }
        const sql = attendancePolicySqlDescriptors(f).find(frame => frame.name === 'preservation')!.sql
        const preserved = JSON.stringify(projectedRows(sql, baseline, untargeted)) === JSON.stringify(projectedRows(sql, changed, untargeted))
        const proof = createAttendancePolicySdkProof(f, target, h.original, { ...h.controls,
          sql: async frame => frame.name === 'preservation'
            ? { sourcePreserved: untargeted || preserved, originalsPreserved: !untargeted || preserved, nativeVerified: false }
            : baseSql(frame),
        })
        await expect(proof.sdk()).rejects.toThrow(/^attendance_policy_proof_refused$/)
        await proof.settle(); expect(proof.receipt().complete).toBe(false)
      }
    })
  it.each([
    ['public.account_plans', 'plan_key', 'free', 'basic'],
    ['public.account_plan_audit', 'new_plan_key', 'free', 'basic'],
    ['public.effective_feature_entitlement_audit', 'reason_code', 'default_free_account_provisioning', 'native_drift'],
  ])('rejects complete automatic provisioning row drift in %s', async (table, field, before, after) => {
      for (const untargeted of [false, true]) {
        const h = harness(), baseSql = h.controls.sql
        const row = { subject_user_id: untargeted ? '00000000-0000-4000-8000-000000000001' : f.actors[0].id, [field]: before }
        const sql = attendancePolicySqlDescriptors(f).find(frame => frame.name === 'preservation')!.sql
        const preserved = JSON.stringify(projectedRows(sql, { [table]: [row] }, untargeted)) ===
          JSON.stringify(projectedRows(sql, { [table]: [{ ...row, [field]: after }] }, untargeted))
        const proof = createAttendancePolicySdkProof(f, target, h.original, { ...h.controls,
          sql: async frame => frame.name === 'preservation'
            ? { sourcePreserved: untargeted || preserved, originalsPreserved: !untargeted || preserved, nativeVerified: false } : baseSql(frame),
        })
        await expect(proof.sdk()).rejects.toThrow(/^attendance_policy_proof_refused$/)
        await proof.settle(); expect(proof.receipt().complete).toBe(false)
      }
    })
})
