import { describe, expect, it } from 'vitest'
import { ATTENDANCE_POLICY_WRITE_CAPS as caps, ATTENDANCE_POLICY_WRITE_ACCOUNTING,
  newAttendancePolicyWriteFixture,assertAttendancePolicyWriteFixture,attendancePolicyWriteSdkInventory,
  attendancePolicyWriteSqlDescriptors,assertAttendancePolicyWriteSqlDescriptor,attendancePolicyWriteHash,
} from '../../scripts/contextual-attendance-policy-write-native-fixture'

describe('inert attendance policy write fixture (CPU source evidence only)',()=>{
  const f=newAttendancePolicyWriteFixture('assignmentlist_012345abcdef'),calls=attendancePolicyWriteSdkInventory(f),frames=attendancePolicyWriteSqlDescriptors(f)
  it('freezes deterministic synthetic identities and rejects namespace/manifest substitution',()=>{
    expect(f).toEqual(newAttendancePolicyWriteFixture('assignmentlist_012345abcdef'))
    expect(Object.isFrozen(f.actors)).toBe(true);expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length)
    expect(f.actors.every(r=>r.email.endsWith('@example.invalid'))).toBe(true)
    expect(()=>newAttendancePolicyWriteFixture('unsafe')).toThrow();expect(()=>assertAttendancePolicyWriteFixture({...f,projectId:'foreign'})).toThrow()
  })
  it('admits exactly 23 bounded immutable source-hashed frames',()=>{
    expect(frames).toHaveLength(23);expect(new Set(frames.map(r=>r.name)).size).toBe(23)
    for(const frame of frames){expect(Buffer.byteLength(frame.sql)).toBeLessThanOrEqual(caps.sqlBytes);expect(frame.sha256).toBe(attendancePolicyWriteHash(frame.sql))
      expect(frame).toMatchObject({profile:'baseline-off',nativeVerified:false});expect(()=>assertAttendancePolicyWriteSqlDescriptor(f,frame)).not.toThrow()
      expect(()=>assertAttendancePolicyWriteSqlDescriptor(f,{...frame,sql:frame.sql+'select 1;'})).toThrow()
      expect(()=>assertAttendancePolicyWriteSqlDescriptor(f,{...frame,sha256:'0'.repeat(64)})).toThrow()
      expect(frame.sql).not.toMatch(/disable\s+trigger|session_replication_role|set\s+role|set_attendance_teacher_entitlement|https?:|storage\.objects/i)
    }
    expect(ATTENDANCE_POLICY_WRITE_ACCOUNTING).toEqual({sqlFrames:23,http:16,fullGuards:78,leafActions:117})
    expect(ATTENDANCE_POLICY_WRITE_ACCOUNTING.leafActions).toBeLessThan(200)
  })
  it('has 13 actual-adapter cases plus 3 exact-canary RPC cases with real denial statuses',()=>{
    expect(calls).toHaveLength(16);expect(calls.filter(c=>c.adapter)).toHaveLength(13);expect(calls.filter(c=>!c.adapter)).toHaveLength(3)
    expect(new Set(calls.map(c=>c.label)).size).toBe(16)
    expect(calls.map(c=>c.status)).toEqual([200,200,200,200,409,409,403,403,403,403,200,404,404,404,404,404])
    expect(calls.every(c=>Object.keys(c.args.p_policy).length===9&&!('p_at'in c.args))).toBe(true)
    expect(calls.filter(c=>!c.adapter).every(c=>c.args.p_scope_mode==='exact_canary')).toBe(true)
    expect(calls.filter(c=>c.transition).map(c=>c.transition)).toEqual(['entitlement-expired','entitlement-revoked','roster-deactivating'])
  })
  it('checks every observed case in order against complete checkpoint rows and immutable complement',()=>{
    for(const[n,call]of calls.entries()){
      const sql=frames.find(r=>r.name===`observe-${n}`)!.sql
      expect(sql).toContain(`b.observed<>${n-1}`);expect(sql).toContain('attendance_write_original_drift');expect(sql).toContain(`'case','${call.label}'`)
      if(call.status===200){expect(sql).toContain('attendance_write_positive_postcondition');expect(sql).toContain("v_row-array['created_at','updated_at']")
        expect(sql).toContain("v_row->'created_at' is distinct from v_old->'created_at'");expect(sql).toContain("v_row->>'updated_at'")
        expect(sql).toContain("v_graph-'attendance_window_policies'");expect(sql).toContain("'updated_at',r.updated_at")
      }else{expect(sql).toContain('v_graph is distinct from b.checkpoint');expect(sql).toContain("'saved',null")}
    }
  })
  it('captures automatic membership and provisioning plus principal/outbox/history whole rows in both partitions',()=>{
    for(const table of ['private.pal_membership_generations','private.attendance_membership_generations','public.account_plans','public.account_plan_audit',
      'public.effective_feature_entitlement_audit','public.attendance_principal_mappings','public.attendance_integration_outbox','public.attendance_status_override_events','public.classroom_roster']){
      const sql=frames.find(r=>r.name==='preservation')!.sql
      expect(sql).toContain(`from ${table} r where (`);expect(sql).toContain(`from ${table} r where not (`)
    }
    expect(frames[0].sql).not.toMatch(/insert into private\.pal_membership_generations|insert into public\.account_plans|classroom_purge_operations\([^)]*\) values/i)
    expect(frames.find(r=>r.name==='witness')!.sql).toContain("g.state='active' and g.scope_digest=private.pal_membership_scope(e.classroom_id,e.student_id)")
    for(const e of f.enrollments)expect(frames.find(r=>r.name==='witness')!.sql).toContain(`('${e.id}'::uuid,'${e.classroomId}'::uuid,'${e.actorId}'::uuid)`)
  })
  it('restores only synthetic policy rows and original entitlement/roster values with whole-graph equality',()=>{
    const sql=frames.find(r=>r.name==='restore-baseline')!.sql
    expect(sql).toContain(`delete from public.attendance_window_policies where classroom_id in (`)
    expect(sql).toContain('jsonb_populate_recordset(null::public.attendance_teacher_entitlements')
    expect(sql).toContain('jsonb_populate_recordset(null::public.attendance_roster_mappings')
    expect(sql).toContain('attendance_write_restore_mismatch');expect(sql).not.toMatch(/delete from public\.(users|classrooms)|drop table|alter table/i)
  })
})
