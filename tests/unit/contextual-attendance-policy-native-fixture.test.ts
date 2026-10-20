import { describe, expect, it } from 'vitest'
import { ATTENDANCE_POLICY_CAPS, assertAttendancePolicyFixture, assertAttendancePolicySqlDescriptor,
  attendancePolicyHash, attendancePolicySdkInventory, attendancePolicySqlDescriptors, newAttendancePolicyFixture,
} from '../../scripts/contextual-attendance-policy-native-fixture'

describe('inert attendance policy fixture', () => {
  const f = newAttendancePolicyFixture('assignmentlist_012345abcdef')
  it('is deterministic, frozen, collision-free and synthetic', () => {
    expect(f).toEqual(newAttendancePolicyFixture('assignmentlist_012345abcdef'))
    expect(Object.isFrozen(f.actors)).toBe(true)
    expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length)
    expect(f.actors.every(a => a.email.endsWith('@example.invalid'))).toBe(true)
    expect(f.actors[0].role).toBe('student')
    expect(() => newAttendancePolicyFixture('unsafe;drop')).toThrow()
    expect(() => assertAttendancePolicyFixture({ ...f, projectId: 'foreign' })).toThrow()
  })
  it('admits only exact deterministic SQL and bounds every frame', () => {
    const frames = attendancePolicySqlDescriptors(f)
    expect(frames).toHaveLength(7)
    for (const frame of frames) {
      expect(frame.profile).toBe('baseline-off')
      expect(frame.nativeVerified).toBe(false)
      expect(Buffer.byteLength(frame.sql)).toBeLessThanOrEqual(ATTENDANCE_POLICY_CAPS.sqlBytes)
      expect(frame.sha256).toBe(attendancePolicyHash(frame.sql))
      expect(() => assertAttendancePolicySqlDescriptor(f, frame)).not.toThrow()
      expect(() => assertAttendancePolicySqlDescriptor(f, { ...frame, sql: `${frame.sql}select 1;` })).toThrow()
      expect(() => assertAttendancePolicySqlDescriptor(f, { ...frame, sha256: '0'.repeat(64) })).toThrow()
      expect(frame.sql).not.toMatch(/set_effective_feature_entitlement|alter\s+table|disable\s+trigger|set\s+role|http|storage\.objects/i)
      expect(frame.sql).not.toMatch(/update\s+(private\.)?\w*settings/i)
    }
  })
  it('has sixteen named sequential identity-bound vectors and honest split coverage', () => {
    const calls = attendancePolicySdkInventory(f)
    expect(calls).toHaveLength(16)
    expect(new Set(calls.map(c => c.label)).size).toBe(16)
    expect(calls.filter(c => c.adapter)).toHaveLength(13)
    expect(calls.filter(c => !c.adapter)).toHaveLength(3)
    expect(calls.filter(c => c.transition).map(c => c.transition)).toEqual([
      'entitlement-expired', 'entitlement-revoked', 'roster-deactivating', 'restore-baseline',
    ])
    expect(calls.every(c => !('p_at' in c.args))).toBe(true)
    expect(calls.filter(c => !c.adapter).every(c => c.args.p_scope_mode === 'exact_canary')).toBe(true)
  })
  it('captures complete synthetic rows and retains originals with exact restoration checks', () => {
    const frames = attendancePolicySqlDescriptors(f), setup = frames[0].sql
    expect(setup).toContain('original_sha256')
    expect(setup).toContain('jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)')
    expect(setup).toContain('update public.classrooms set teacher_id=')
    expect(frames.find(r => r.name === 'restore-baseline')!.sql).toContain('attendance_graph_restore_mismatch')
    expect(frames.find(r => r.name === 'preservation')!.sql).toContain("'originalsPreserved'")
    expect(frames.every(r => !/delete\s+from|drop\s+table/i.test(r.sql))).toBe(true)
  })
})
