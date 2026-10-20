import {describe,expect,it} from 'vitest'
import {validateV1Message} from '../../src/vendor/attendance-contract/v1/validate'
import {ATTENDANCE_SESSION_CAPS as caps,ATTENDANCE_SESSION_ACCOUNTING,newAttendanceSessionFixture,assertAttendanceSessionFixture,
  attendanceSessionSdkInventory,attendanceSessionSqlDescriptors,assertAttendanceSessionSqlDescriptor,attendanceSessionHash,attendanceSessionExpectedView} from '../../scripts/contextual-attendance-session-native-fixture'
describe('inert owner session fixture (CPU source evidence only)',()=>{
  const f=newAttendanceSessionFixture('assignmentlist_012345abcdef'),calls=attendanceSessionSdkInventory(f),frames=attendanceSessionSqlDescriptors(f)
  it('is synthetic, deterministic, frozen and collision-free',()=>{
    expect(f).toEqual(newAttendanceSessionFixture('assignmentlist_012345abcdef'));expect(Object.isFrozen(f.facts)).toBe(true)
    expect(f.tag).toBe('attendance_session_012345abcdef');expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length)
    expect(f.actors.every(a=>a.email.endsWith('@example.invalid'))).toBe(true)
    expect(()=>newAttendanceSessionFixture('unsafe')).toThrow();expect(()=>assertAttendanceSessionFixture({...f,projectId:'foreign'})).toThrow()
  })
  it('admits exactly 26 closed byte-bounded frames and fixed original-budget accounting',()=>{
    expect(frames).toHaveLength(26);expect(new Set(frames.map(r=>r.name)).size).toBe(26)
    expect(ATTENDANCE_SESSION_ACCOUNTING).toEqual({sqlFrames:26,http:16,fullGuards:84,leafActions:126})
    for(const frame of frames){expect(Buffer.byteLength(frame.sql)).toBeLessThanOrEqual(caps.sqlBytes);expect(frame.sha256).toBe(attendanceSessionHash(frame.sql))
      expect(frame).toMatchObject({profile:'baseline-off',nativeVerified:false});expect(()=>assertAttendanceSessionSqlDescriptor(f,frame)).not.toThrow()
      expect(()=>assertAttendanceSessionSqlDescriptor(f,{...frame,sql:frame.sql+'select 1;'})).toThrow()
      expect(()=>assertAttendanceSessionSqlDescriptor(f,{...frame,sha256:'0'.repeat(64)})).toThrow()
      expect(frame.sql).not.toMatch(/disable trigger|session_replication_role|set role|https?:|storage\.objects|insert into private\.pal_membership_generations/i)
    }
  })
  it('has 13 actual adapter and 3 typed canary cases with owner roster-only compatibility',()=>{
    expect(calls).toHaveLength(16);expect(calls.filter(c=>c.adapter)).toHaveLength(13);expect(calls.filter(c=>!c.adapter)).toHaveLength(3)
    expect(new Set(calls.map(c=>c.label)).size).toBe(16)
    expect(calls.map(c=>c.status)).toEqual(['ok','ok','forbidden','forbidden','forbidden','forbidden','ok','ok','ok','ok','ok','ok','ok','ok','blocked','ok'])
    expect(calls.every(c=>!('p_at'in c.args)&&c.args.p_installation_ref===f.installationRef)).toBe(true)
    expect(calls.filter(c=>c.transition).map(c=>c.transition)).toEqual(['policy-disabled','entitlement-expired','entitlement-revoked','roster-deactivating','purge-fenced','restore-baseline'])
    expect(attendanceSessionExpectedView(f,calls[6])).toMatchObject({integration:'disabled',students:[{firstName:'Archived',status:'unmarked'}]})
    expect(attendanceSessionExpectedView(f,calls[10])).toMatchObject({integration:'not_configured'})
  })
  it('uses validated V1 messages and an independent full browser DTO oracle',()=>{
    expect(f.outbox.every(r=>validateV1Message(r.payload).ok)).toBe(true)
    const view=attendanceSessionExpectedView(f,calls[0])!
    expect(view.session).toMatchObject({state:'open',revision:4,pendingCommand:true,commandFailed:false})
    expect(view.sync).toEqual({state:'pending',confirmedAt:f.time.updated})
    expect(view.students).toEqual([
      {studentId:f.actors[0].id,firstName:'Owner',lastName:'Synthetic',status:'present',source:'student_qr',checkedInAt:f.time.accepted,revision:1,hasQrCheckIn:true,hasManualOverride:false,pendingCommand:true,commandFailed:false},
      {studentId:f.actors[2].id,firstName:'Member',lastName:'Synthetic',status:'late',source:'staff',checkedInAt:null,revision:3,hasQrCheckIn:false,hasManualOverride:true,pendingCommand:false,commandFailed:false}])
    expect(JSON.stringify(view)).not.toMatch(/example\.invalid|participant_|principal_|occurrence_|installation_ref|payload/)
  })
  it('captures complete profiles, automatic generations/provisioning, facts, history, principals and queue in both partitions',()=>{
    const sql=frames.find(r=>r.name==='preservation')!.sql
    for(const table of ['public.student_profiles','private.pal_membership_generations','public.account_plans','public.account_plan_audit','public.effective_feature_entitlement_audit',
      'public.attendance_check_in_facts','public.attendance_status_overrides','public.attendance_status_override_events','public.attendance_principal_mappings','public.attendance_integration_outbox']){
      expect(sql).toContain(`from ${table} r where (`);expect(sql).toContain(`from ${table} r where not (`)
    }
    const witness=frames.find(r=>r.name==='witness')!.sql
    for(const e of f.enrollments)expect(witness).toContain(`('${e.id}'::uuid,'${e.classroomId}'::uuid,'${e.actorId}'::uuid)`)
    expect(witness).toContain("g.state='active' and g.scope_digest=private.pal_membership_scope(e.classroom_id,e.student_id)")
  })
  it('freshly checks every read for unchanged whole rows and restores exact state before final success',()=>{
    for(const[n,call]of calls.entries()){const sql=frames.find(r=>r.name===`observe-${n}`)!.sql
      expect(sql).toContain(`<>${n-1}`);expect(sql).toContain('checkpoint');expect(sql).toContain('original_sha256');expect(sql).toContain(`'case','${call.label}'`)}
    const restore=frames.find(r=>r.name==='restore-baseline')!.sql
    expect(restore).toContain('attendance_session_restore_mismatch');expect(restore).toContain('jsonb_populate_recordset(null::public.attendance_window_policies')
    expect(restore).toContain('attendance_session_partial_setup')
    expect(restore).toContain('delete from public.classroom_purge_fences where operation_id=')
    const purge=frames.find(r=>r.name==='purge-fenced')!.sql
    const mutation=purge.slice(0,purge.indexOf(`update ${f.baseline}`))
    expect(mutation).toContain(`'${f.classes[3].id}'`);expect(mutation).not.toContain(`'${f.classes[0].id}'`)
  })
})
