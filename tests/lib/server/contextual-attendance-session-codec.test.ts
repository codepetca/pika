import { describe,expect,it } from 'vitest'
import { buildTeacherAttendanceViewFromSnapshot } from '@/lib/server/bara-attendance-view'
const id='10000000-0000-4000-8000-000000000001',instant='2026-10-20T13:00:00Z'
const occurrence={occurrence_ref:'occurrence_one',opens_at:instant,closes_at:'2026-10-20T14:00:00Z',session_starts_at:instant,session_ends_at:'2026-10-20T14:10:00Z',present_through_at:'2026-10-20T13:05:00Z',absent_at:'2026-10-20T14:00:00Z'}
const rows=()=>({participants:[],occurrence,policy:{enabled:false},session:{occurrence_ref:'occurrence_one',status:'open',opens_at:instant,closes_at:occurrence.closes_at,session_revision:1,updated_at:instant},
  check_ins:[{student_id:id,check_in_ref:'check_in_one',check_in_revision:1,accepted_at:'2026-10-20T13:06:00Z',invalidated_at:null,updated_at:instant}],overrides:[],outbox:[]})
const input=()=>({classroomId:id,classDate:'2026-10-20',integration:'ready' as const,students:[{studentId:id,firstName:'Owner',lastName:''}],rows:rows(),now:'2026-10-20T15:00:00Z'})
describe('shared strict owner session converter',()=>{
  it('uses observed clock and preserves ready occurrence even when timing policy is disabled',()=>{
    expect(buildTeacherAttendanceViewFromSnapshot(input())).toMatchObject({integration:'ready',session:{state:'open'},students:[{status:'late',source:'student_qr',hasQrCheckIn:true}]})
    expect(buildTeacherAttendanceViewFromSnapshot({...input(),rows:{...rows(),check_ins:[]}})).toMatchObject({students:[{status:'absent',source:'system'}]})
  })
  it('preserves overrides, invalidation audit facts, and Undo',()=>{
    const override={student_id:id,status:'present',active:true,revision:2,updated_at:instant}
    const base={...rows(),overrides:[override]}
    expect(buildTeacherAttendanceViewFromSnapshot({...input(),rows:base}).students[0]).toMatchObject({status:'present',source:'staff',hasManualOverride:true})
    expect(buildTeacherAttendanceViewFromSnapshot({...input(),rows:{...base,overrides:[{...override,status:null,active:false}]}}).students[0]).toMatchObject({status:'late',source:'student_qr'})
    expect(buildTeacherAttendanceViewFromSnapshot({...input(),rows:{...rows(),check_ins:rows().check_ins.map(r=>({...r,invalidated_at:'2026-10-20T13:10:00Z'}))}}).students[0]).toMatchObject({status:'absent',hasQrCheckIn:false})
  })
  it('uses unchanged V1 validation and pending-over-failure semantics with the one observed time',()=>{
    const payload={schema_version:1,message_type:'check_in.invalidate',idempotency_key:'invalidate:one',correlation_ref:'correlation_one',installation_ref:'test_installation',roster_ref:'roster_one',occurrence_ref:'occurrence_one',actor_principal_ref:'principal_owner',actor_display_name:'Owner',invalidations:[{command_ref:'command_one',check_in_ref:'check_in_one',reason_code:'staff_reset'}]}
    const outbox=[{message_type:'check_in.invalidate',payload,status:'non_retryable',lease_expires_at:null,updated_at:instant},
      {message_type:'check_in.invalidate',payload:{...payload,idempotency_key:'invalidate:two'},status:'processing',lease_expires_at:'2026-10-20T15:00:01Z',updated_at:instant}]
    const view=buildTeacherAttendanceViewFromSnapshot({...input(),rows:{...rows(),outbox}})
    expect(view.sync.state).toBe('pending');expect(view.students[0]).toMatchObject({pendingCommand:true,commandFailed:false})
    expect(JSON.stringify(view)).not.toMatch(/principal_|roster_|occurrence_|check_in_|participant_|idempotency/)
    expect(()=>buildTeacherAttendanceViewFromSnapshot({...input(),rows:{...rows(),outbox:[{...outbox[0],payload:{secret:'bad'}}]}})).toThrow('invalid_projection')
  })
  it('handles not-scheduled, disabled roster and strict row rejection',()=>{
    expect(buildTeacherAttendanceViewFromSnapshot({...input(),rows:{...rows(),occurrence:null,session:null}})).toMatchObject({integration:'not_configured',session:{state:'not_scheduled'}})
    expect(buildTeacherAttendanceViewFromSnapshot({...input(),integration:'disabled'})).toMatchObject({integration:'disabled',students:[{status:'unmarked',hasQrCheckIn:false}]})
    expect(()=>buildTeacherAttendanceViewFromSnapshot({...input(),rows:{...rows(),unknown:'private'}})).toThrow('invalid_projection')
  })
})
