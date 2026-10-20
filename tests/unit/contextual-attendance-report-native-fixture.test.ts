import {describe,expect,it} from 'vitest'
import {ATTENDANCE_REPORT_CAPS as caps,ATTENDANCE_REPORT_ACCOUNTING,newAttendanceReportFixture,assertAttendanceReportFixture,
  attendanceReportSdkInventory,attendanceReportSqlDescriptors,assertAttendanceReportSqlDescriptor,attendanceReportHash,attendanceReportExpectedView,attendanceReportExpectedSnapshot} from '../../scripts/contextual-attendance-report-native-fixture'
describe('inert Daily Log owner report fixture (CPU only)',()=>{
  const f=newAttendanceReportFixture('assignmentlist_012345abcdef'),calls=attendanceReportSdkInventory(f),frames=attendanceReportSqlDescriptors(f)
  it('freezes deterministic collision-free synthetic identities and an unseeded missing classroom',()=>{
    expect(f).toEqual(newAttendanceReportFixture('assignmentlist_012345abcdef'));expect(Object.isFrozen(f.entries)).toBe(true)
    expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length);expect(f.actors.every(a=>a.email.endsWith('@example.invalid'))).toBe(true)
    expect(f.classes.some(c=>c.id===f.missingClassId)).toBe(false);expect(f.allocatedIds).toContain(f.missingClassId)
    expect(()=>newAttendanceReportFixture('unsafe')).toThrow();expect(()=>assertAttendanceReportFixture({...f,projectId:'foreign'})).toThrow()
  })
  it('issues only 18 exact bounded hashed SQL frames and 12 actual-adapter vectors',()=>{
    expect(frames).toHaveLength(18);expect(new Set(frames.map(r=>r.name)).size).toBe(18)
    expect(ATTENDANCE_REPORT_ACCOUNTING).toEqual({sqlFrames:18,http:12,fullGuards:60,leafActions:90})
    expect(calls).toHaveLength(12);expect(calls.map(c=>c.status)).toEqual(['ok','ok','ok','ok','forbidden','forbidden','forbidden','forbidden','forbidden','blocked','ok','ok'])
    expect(calls.every(c=>Object.keys(c.args).join(',')==='p_actor_id,p_classroom_id')).toBe(true)
    for(const frame of frames){expect(Buffer.byteLength(frame.sql)).toBeLessThanOrEqual(caps.sqlBytes);expect(frame.sha256).toBe(attendanceReportHash(frame.sql))
      expect(frame).toMatchObject({profile:'baseline-off',nativeVerified:false});expect(()=>assertAttendanceReportSqlDescriptor(f,frame)).not.toThrow()
      expect(frame.sql).not.toContain(`${f.baseline}set`)
      expect(()=>assertAttendanceReportSqlDescriptor(f,{...frame,sql:frame.sql+'select 1;'})).toThrow()
      expect(()=>assertAttendanceReportSqlDescriptor(f,{...frame,sha256:'0'.repeat(64)})).toThrow()
      expect(frame.sql).not.toMatch(/disable trigger|session_replication_role|set role|https?:|storage\.objects|insert into private\.pal_membership_generations/i)
    }
  })
  it('hand-codes complete Unicode, future, non-class-day and archived report expectations',()=>{
    const view=attendanceReportExpectedView(f,calls[0])!
    expect(view.dates).toEqual(['2000-01-03','2000-01-04','2000-01-05','2099-01-03','2099-01-04'])
    expect(view.attendance.map(r=>r.summary)).toEqual([{present:3,absent:1},{present:1,absent:2}])
    expect(view.attendance[0].dates).toEqual({'2000-01-03':'present','2000-01-04':'absent','2000-01-05':'present','2099-01-03':'pending','2099-01-04':'present'})
    expect(JSON.stringify(view)).not.toContain(f.journalSentinel)
    expect(attendanceReportExpectedView(f,calls[1])!.attendance[0]).toMatchObject({student_first_name:'',student_last_name:'',summary:{present:1,absent:0}})
    expect(attendanceReportExpectedView(f,calls[2])!.attendance[0]).toMatchObject({student_first_name:'Archived',summary:{present:1,absent:1}})
    expect(attendanceReportExpectedView(f,calls[3])).toEqual({attendance:[],dates:[],classroom_id:f.classes[3].id})
  })
  it('retains nonroster journal rows in preservation but excludes them from internal snapshots and all browser DTOs',()=>{
    const snapshot=attendanceReportExpectedSnapshot(f,calls[0],'2026-10-20T00:00:00Z')
    expect(f.entries.filter(e=>e.classroom_id===f.classes[0].id&&e.student_id===f.actors[3].id)).toHaveLength(1)
    expect(snapshot.entries.every(e=>e.student_id!==f.actors[3].id)).toBe(true)
    expect(snapshot.entries.some(e=>e.text===f.journalSentinel)).toBe(true)
    for(const call of calls)expect(JSON.stringify(attendanceReportExpectedView(f,call))).not.toContain(f.journalSentinel)
  })
  it('includes complete profiles, days, entries, generations and automatic provisioning in both partitions',()=>{
    const sql=frames.find(r=>r.name==='preservation')!.sql
    for(const table of ['public.student_profiles','public.class_days','public.entries','private.pal_membership_generations','public.account_plans','public.account_plan_audit','public.effective_feature_entitlement_audit']){
      expect(sql).toContain(`from ${table} r where (`);expect(sql).toContain(`from ${table} r where not (`)
    }
    expect(sql).toContain('jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)')
    const witness=frames.find(r=>r.name==='witness')!.sql
    for(const e of f.enrollments)expect(witness).toContain(`('${e.id}'::uuid,'${e.classroomId}'::uuid,'${e.actorId}'::uuid)`)
    expect(witness).toContain("g.state='active'and g.scope_digest=private.pal_membership_scope(e.classroom_id,e.student_id)")
    expect(witness).toContain("'nonRosterEntries'")
  })
  it('checks every read and restores only exact synthetic purge rows without reenrolling or rewriting report facts',()=>{
    for(const[n,call]of calls.entries()){const sql=frames.find(r=>r.name===`observe-${n}`)!.sql;expect(sql).toContain(`<>${n-1}`);expect(sql).toContain('checkpoint');expect(sql).toContain('original_sha256');expect(sql).toContain(`'case','${call.label}'`)}
    const restore=frames.find(r=>r.name==='restore-baseline')!.sql
    expect(restore).toContain('attendance_report_partial_setup');expect(restore).toContain('attendance_report_restore_mismatch')
    expect(restore).toContain(`delete from public.classroom_purge_fences where operation_id='${f.purgeId}'`)
    expect(restore).not.toMatch(/update public\.|delete from public\.(entries|class_days|classroom_enrollments)/)
    expect(frames.find(r=>r.name==='setup')!.sql).toContain("'revoked','2020-01-01'")
  })
})
