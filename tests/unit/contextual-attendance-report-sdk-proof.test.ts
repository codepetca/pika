import {describe,expect,it,vi} from 'vitest'
import {createAttendanceReportSdkProof,assertAttendanceReportProofReceipt,type AttendanceReportProofControls} from '../../scripts/contextual-attendance-report-sdk-proof'
import {newAttendanceReportFixture,attendanceReportSdkInventory,attendanceReportSqlDescriptors,attendanceReportExpectedSnapshot,type AttendanceReportSqlDescriptor} from '../../scripts/contextual-attendance-report-native-fixture'
describe('Daily Log owner report SDK leaf (CPU only; no native evidence)',()=>{
  const f=newAttendanceReportFixture('assignmentlist_012345abcdef'),calls=attendanceReportSdkInventory(f),target={origin:'http://127.0.0.1:54331',serviceRoleKey:'synthetic-service-role-key'}
  function harness(options:{alter?:(data:ReturnType<typeof attendanceReportExpectedSnapshot>,n:number)=>unknown;response?:()=>Response;sql?:(frame:AttendanceReportSqlDescriptor,value:unknown)=>unknown}={}){
    const events:string[]=[];let n=0,active=0,maximum=0
    const original:typeof fetch=vi.fn(async(url,init)=>{const index=n++,call=calls[index]
      expect(url).toBe(`${target.origin}/rest/v1/rpc/read_attendance_report_for_owner_v1`);expect(init?.redirect).toBe('error');expect(JSON.parse(String(init?.body))).toEqual(call.args)
      events.push(`http:${call.label}`);const data=attendanceReportExpectedSnapshot(f,call,'2026-10-20T00:00:00.000Z')
      return options.response?.()??new Response(JSON.stringify(options.alter?options.alter(data,index):data),{headers:{'content-type':'application/json'}})})
    const controls:AttendanceReportProofControls={deadline:Date.now()+30000,cleanupDeadline:Date.now()+50000,guard:async()=>{events.push('guard')},account:vi.fn(),httpSession:value=>{active+=value?1:-1;maximum=Math.max(maximum,active)},
      sql:async frame=>{events.push(`sql:${frame.name}`);const value=frame.name==='witness'?{studentOwner:true,membershipGenerationRows:4,profiles:3,classDays:11,entries:15,nonRosterEntries:1,revokedBaraGrant:true,nativeVerified:false}
        :frame.name==='preservation'?{sourcePreserved:true,originalsPreserved:true,nativeVerified:false}
        :frame.name.startsWith('observe-')?{case:calls[Number(frame.name.slice(8))].label,preserved:true,nativeVerified:false}:{stage:frame.name,nativeVerified:false}
        return options.sql?options.sql(frame,value):value}}
    return{original,controls,events,proof:createAttendanceReportSdkProof(f,target,original,controls),active:()=>active,maximum:()=>maximum}
  }
  it('constructs inertly and exercises 12 captured actual-adapter calls through the installed SDK with no env or fetch mutation',async()=>{
    const h=harness();expect(h.events).toEqual([]);expect(h.original).not.toHaveBeenCalled();const originalGlobalFetch=globalThis.fetch
    const receipt=await h.proof.sdk();await h.proof.settle();expect(globalThis.fetch).toBe(originalGlobalFetch)
    expect(receipt).toMatchObject({complete:true,nativeVerified:false,requests:12,adapterRequests:12,rpcRequests:0,descriptorCalls:18,guardCalls:60,restoreState:'restored',failed:false,poisoned:false,sessions:0,unsettled:0})
    expect(h.maximum()).toBe(1);expect(h.active()).toBe(0);expect(receipt.physical.every(p=>p.status===200)).toBe(true);expect(receipt.physical.filter(p=>p.dtoSha256)).toHaveLength(6)
    for(let n=0;n<h.events.length;n++)if(h.events[n].startsWith('http:')||h.events[n].startsWith('sql:')){expect(h.events[n-1]).toBe('guard');expect(h.events[n+1]).toBe('guard')}
    expect(h.events.indexOf('sql:restore-baseline')).toBeLessThan(h.events.indexOf('http:restored-empty-owner'))
    expect(()=>assertAttendanceReportProofReceipt({...receipt,nativeVerified:true})).toThrow();expect(()=>assertAttendanceReportProofReceipt({...receipt,requests:13})).toThrow()
    expect(()=>assertAttendanceReportProofReceipt({...receipt,physical:receipt.physical.slice(1)})).toThrow()
    expect(()=>assertAttendanceReportProofReceipt({...receipt,physical:receipt.physical.map(p=>({...p,dtoSha256:null}))})).toThrow()
  })
  it('normalizes raw set order while enforcing the independent exact browser DTO order and stats',async()=>{
    const h=harness({alter:data=>({...data,students:[...data.students].reverse(),class_days:[...data.class_days].reverse(),entries:[...data.entries].reverse()})})
    expect((await h.proof.sdk()).complete).toBe(true);await h.proof.settle()
  })
  it.each(['actor_id','classroom_id'])('rejects substituted %s after one physical call and restores after positive closure',async field=>{
    const h=harness({alter:data=>({...data,[field]:f.actors[3].id})});await expect(h.proof.sdk()).rejects.toThrow(/^attendance_report_proof_refused$/);await h.proof.settle()
    expect(h.original).toHaveBeenCalledTimes(1);expect(h.active()).toBe(0);expect(h.proof.receipt()).toMatchObject({failed:true,complete:false,poisoned:false,restoreState:'restored'})
  })
  it.each(['students','class_days','entries'])('rejects denied snapshots disclosing %s',async field=>{
    const h=harness({alter:(data,n)=>n===4?{...data,[field]:attendanceReportExpectedSnapshot(f,calls[0],data.observed_at)[field as 'students'|'class_days'|'entries']}:data})
    await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(5)
  })
  it.each(['bad-clock','unknown-field','number-text','nonroster-entry','wrong-class-day'])('rejects malformed/private raw snapshot %s',async mode=>{
    const h=harness({alter:data=>mode==='bad-clock'?{...data,observed_at:'private-invalid-time'}:mode==='unknown-field'?{...data,private:'secret'}:
      mode==='number-text'?{...data,entries:data.entries.map((e,n)=>n?e:{...e,text:123})}:mode==='nonroster-entry'?{...data,entries:[...data.entries,f.entries.find(e=>e.student_id===f.actors[3].id&&e.classroom_id===f.classes[0].id)]}:
      {...data,class_days:data.class_days.map((d,n)=>n?d:{...d,classroom_id:f.classes[1].id})}})
    await expect(h.proof.sdk()).rejects.toThrow(/^attendance_report_proof_refused$/);await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(1)
  })
  it.each([302,403,503])('rejects unexpected HTTP%s without confusing transport with semantic status',async status=>{
    const h=harness({response:()=>new Response('private-error',{status,headers:{'content-type':'application/json'}})})
    await expect(h.proof.sdk()).rejects.toThrow(/^attendance_report_proof_refused$/);await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(1);expect(h.active()).toBe(0)
  })
  it('rejects oversize, invalid JSON, non-JSON and invalid UTF8 bodies and closes sessions',async()=>{
    for(const response of [()=>new Response('x'.repeat(16385),{headers:{'content-type':'application/json'}}),()=>new Response('{',{headers:{'content-type':'application/json'}}),
      ()=>new Response('{}',{headers:{'content-type':'text/plain'}}),()=>new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}})]){
      const h=harness({response});await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.active()).toBe(0);expect(h.original).toHaveBeenCalledTimes(1)}
  })
  it.each([0,3,5])('rejects wrong active generation binding count %s before HTTP',async count=>{
    const h=harness({sql:(frame,value)=>frame.name==='witness'?{...(value as object),membershipGenerationRows:count}:value})
    await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).not.toHaveBeenCalled()
  })
  it('rejects fresh SQL read drift, preservation failure, and ordinary replay without new dispatch',async()=>{
    for(const name of ['observe-0','preservation']){const h=harness({sql:(frame,value)=>frame.name===name?{...(value as object),...(name==='preservation'?{originalsPreserved:false}:{preserved:false})}:value})
      await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.proof.receipt().complete).toBe(false)}
    const h=harness();await h.proof.sdk();await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(12)
  })
  it('sanitizes an aborted native callback without retrying or claiming restoration',async()=>{
    const h=harness(),original:typeof fetch=vi.fn(async()=>{throw new DOMException('private-secret','AbortError')})
    const proof=createAttendanceReportSdkProof(f,target,original,h.controls);await expect(proof.sdk()).rejects.toThrow(/^attendance_report_proof_refused$/)
    expect(original).toHaveBeenCalledTimes(1);expect(proof.receipt()).toMatchObject({complete:false,failed:true,poisoned:true,sessions:0,nativeVerified:false})
  })
  it('does not restore while physical fetch closure is uncertain and retains the original cleanup clock',async()=>{
    const h=harness(),now=Date.now(),original:typeof fetch=vi.fn(()=>new Promise<Response>(()=>{}))
    const proof=createAttendanceReportSdkProof(f,target,original,{...h.controls,deadline:now+80,cleanupDeadline:now+160})
    await expect(proof.sdk()).rejects.toThrow();expect(original).toHaveBeenCalledTimes(1)
    expect(proof.receipt()).toMatchObject({failed:true,poisoned:true,complete:false,restoreState:'prepared',sessions:1,nativeVerified:false})
    expect(proof.receipt().unsettled).toBeGreaterThan(0);expect(h.events).not.toContain('sql:restore-baseline')
  })
  it.each([['public.student_profiles','first_name'],['public.class_days','is_class_day'],['public.entries','text'],['private.pal_membership_generations','state'],['public.account_plan_audit','new_plan_key']])(
    'rejects complete %s %s row drift in synthetic and original partitions',async(table,field)=>{
      const sql=attendanceReportSqlDescriptors(f).find(r=>r.name==='preservation')!.sql
      for(const untargeted of[false,true]){const projection=(row:unknown)=>sql.includes(`from ${table} r where ${untargeted?'not ':''}(`)?{[table]:[row]}:{}
        const preserved=JSON.stringify(projection({id:'synthetic',[field]:'before'}))===JSON.stringify(projection({id:'synthetic',[field]:'after'}))
        const h=harness({sql:(frame,value)=>frame.name==='preservation'?{...(value as object),sourcePreserved:untargeted||preserved,originalsPreserved:!untargeted||preserved}:value})
        await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.proof.receipt().complete).toBe(false)}
    })
})
