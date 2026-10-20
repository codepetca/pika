import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createAttendanceSessionSdkProof,assertAttendanceSessionProofReceipt,type AttendanceSessionProofControls} from '../../scripts/contextual-attendance-session-sdk-proof'
import {newAttendanceSessionFixture,attendanceSessionSdkInventory,attendanceSessionSqlDescriptors,attendanceSessionExpectedSnapshot,type AttendanceSessionSqlDescriptor} from '../../scripts/contextual-attendance-session-native-fixture'
describe('owner session SDK leaf (CPU only; no native evidence)',()=>{
  const f=newAttendanceSessionFixture('assignmentlist_012345abcdef'),calls=attendanceSessionSdkInventory(f),target={origin:'http://127.0.0.1:54331',serviceRoleKey:'synthetic-service-role-key'}
  beforeEach(()=>{vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED','true');vi.stubEnv('PIKA_BARA_ATTENDANCE_SCOPE_MODE','teacher_entitlements')
    vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL','http://127.0.0.1:9');vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF',f.installationRef)
    vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET','synthetic-session-proof-secret-v1')})
  afterEach(()=>vi.unstubAllEnvs())
  function harness(options:{alter?:(data:Record<string,unknown>,n:number)=>unknown;response?:()=>Response;sql?:(frame:AttendanceSessionSqlDescriptor,value:unknown)=>unknown}={}){
    const events:string[]=[];let n=0,active=0,maximum=0
    const original:typeof fetch=vi.fn(async(url,init)=>{const index=n++,call=calls[index]
      expect(url).toBe(`${target.origin}/rest/v1/rpc/read_attendance_session_for_owner_v1`);expect(init?.redirect).toBe('error');expect(JSON.parse(String(init?.body))).toEqual(call.args)
      events.push(`http:${call.label}`);const data=attendanceSessionExpectedSnapshot(f,call,new Date().toISOString())
      return options.response?.()??new Response(JSON.stringify(options.alter?options.alter(data,index):data),{headers:{'content-type':'application/json'}})})
    const controls:AttendanceSessionProofControls={deadline:Date.now()+30000,cleanupDeadline:Date.now()+50000,guard:async()=>{events.push('guard')},account:vi.fn(),
      httpSession:value=>{active+=value?1:-1;maximum=Math.max(maximum,active)},sql:async frame=>{events.push(`sql:${frame.name}`)
        const value=frame.name==='witness'?{studentOwner:true,membershipGenerationRows:3,facts:2,outbox:4,nativeVerified:false}
          :frame.name==='preservation'?{sourcePreserved:true,originalsPreserved:true,nativeVerified:false}
          :frame.name.startsWith('observe-')?{case:calls[Number(frame.name.slice(8))].label,preserved:true,nativeVerified:false}:{stage:frame.name,nativeVerified:false}
        return options.sql?options.sql(frame,value):value}}
    return{original,controls,events,proof:createAttendanceSessionSdkProof(f,target,original,controls),active:()=>active,maximum:()=>maximum}
  }
  it('constructs inertly and exercises the actual adapter/installed SDK and complete independent DTO oracle',async()=>{
    const h=harness();expect(h.events).toEqual([]);expect(h.original).not.toHaveBeenCalled()
    const receipt=await h.proof.sdk();await h.proof.settle()
    expect(receipt).toMatchObject({complete:true,nativeVerified:false,requests:16,adapterRequests:13,rpcRequests:3,descriptorCalls:26,guardCalls:84,restoreState:'restored',failed:false,poisoned:false,sessions:0,unsettled:0})
    expect(h.maximum()).toBe(1);expect(h.active()).toBe(0);expect(receipt.physical.every(p=>p.status===200)).toBe(true)
    expect(receipt.physical.filter(p=>p.dtoSha256)).toHaveLength(8)
    for(let n=0;n<h.events.length;n++)if(h.events[n].startsWith('http:')||h.events[n].startsWith('sql:')){expect(h.events[n-1]).toBe('guard');expect(h.events[n+1]).toBe('guard')}
    expect(h.events.indexOf('sql:restore-baseline')).toBeLessThan(h.events.indexOf('http:restored-owner-full-ready'))
    expect(()=>assertAttendanceSessionProofReceipt({...receipt,nativeVerified:true})).toThrow()
    expect(()=>assertAttendanceSessionProofReceipt({...receipt,physical:receipt.physical.slice(1)})).toThrow()
    expect(()=>assertAttendanceSessionProofReceipt({...receipt,physical:receipt.physical.map(p=>({...p,dtoSha256:null}))})).toThrow()
  })
  it.each(['actor_id','classroom_id','class_date','runtime_integration','scope_mode','installation_ref'])('rejects substituted %s with no retry and restores after closure',async field=>{
    const h=harness({alter:data=>({...data,[field]:field==='class_date'?'2026-09-03':field==='runtime_integration'?'disabled':field==='scope_mode'?'exact_canary':field==='installation_ref'?'foreign-installation':f.actors[3].id})})
    await expect(h.proof.sdk()).rejects.toThrow(/^attendance_session_proof_refused$/);await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(1)
    expect(h.active()).toBe(0);expect(h.proof.receipt()).toMatchObject({complete:false,failed:true,poisoned:false,restoreState:'restored',nativeVerified:false})
  })
  it('rejects denied snapshots containing roster or attendance disclosure',async()=>{
    for(const field of ['students','rows']){const h=harness({alter:(data,n)=>n===2?{...data,[field]:attendanceSessionExpectedSnapshot(f,calls[0],new Date().toISOString())[field as 'students'|'rows']}:data})
      await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(3)}
  })
  it('rejects full snapshot projection drift and unknown private fields',async()=>{
    for(const alter of [(data:Record<string,unknown>)=>({...data,private:'secret'}),
      (data:Record<string,unknown>)=>({...data,rows:{...(data.rows as object),session:null}}),
      (data:Record<string,unknown>)=>({...data,students:[]})]){const h=harness({alter});await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(1)}
  })
  it.each([302,403,503])('rejects unexpected transport HTTP%s even though semantic denials are HTTP200',async status=>{
    const h=harness({response:()=>new Response('private-error',{status,headers:{'content-type':'application/json'}})})
    await expect(h.proof.sdk()).rejects.toThrow(/^attendance_session_proof_refused$/);await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(1);expect(h.active()).toBe(0)
  })
  it('rejects oversize/non-JSON streams and closes their sessions',async()=>{
    for(const response of [()=>new Response('x'.repeat(16385),{headers:{'content-type':'application/json'}}),()=>new Response('{}',{headers:{'content-type':'text/plain'}})]){
      const h=harness({response});await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.active()).toBe(0)}
  })
  it.each([0,2,4])('rejects an incorrect actual bound generation count %s',async count=>{
    const h=harness({sql:(frame,value)=>frame.name==='witness'?{...(value as object),membershipGenerationRows:count}:value})
    await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).not.toHaveBeenCalled()
  })
  it('refuses fresh read graph drift and full preservation failure',async()=>{
    for(const name of ['observe-0','preservation']){const h=harness({sql:(frame,value)=>frame.name===name?{...(value as object),...(name==='preservation'?{originalsPreserved:false}:{preserved:false})}:value})
      await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.proof.receipt().complete).toBe(false)}
  })
  it('refuses replay without another physical dispatch',async()=>{const h=harness();await h.proof.sdk();await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(16)})
  it('does not restore while fetch closure remains uncertain or extend the original cleanup deadline',async()=>{
    const h=harness(),now=Date.now(),original:typeof fetch=vi.fn(()=>new Promise<Response>(()=>{}))
    const proof=createAttendanceSessionSdkProof(f,target,original,{...h.controls,deadline:now+80,cleanupDeadline:now+160})
    await expect(proof.sdk()).rejects.toThrow();expect(proof.receipt()).toMatchObject({failed:true,poisoned:true,complete:false,restoreState:'prepared',sessions:1,nativeVerified:false})
    expect(proof.receipt().unsettled).toBeGreaterThan(0);expect(h.events).not.toContain('sql:restore-baseline');expect(original).toHaveBeenCalledTimes(1)
  })
  // Source-plan oracle only: omitting a complete-row table from either admitted
  // partition makes this CPU regression fail. SQL execution is still separate.
  it.each([
    ['public.student_profiles','first_name','Owner','Changed'],
    ['private.pal_membership_generations','state','active','removed'],
    ['public.account_plan_audit','new_plan_key','free','basic'],
    ['public.effective_feature_entitlement_audit','reason_code','default_free_account_provisioning','changed'],
    ['public.attendance_check_in_facts','invalidated_at',null,'2026-09-02T14:00:00+00:00'],
    ['public.attendance_status_overrides','status','late','present'],
    ['public.attendance_integration_outbox','payload',{command:'open'},{command:'close'}],
  ])('refuses complete-row %s %s drift in both partitions',async(table,field,before,after)=>{
    const sql=attendanceSessionSqlDescriptors(f).find(frame=>frame.name==='preservation')!.sql
    for(const untargeted of[false,true]){
      const projection=(row:unknown)=>sql.includes(`from ${table} r where ${untargeted?'not ':''}(`)?{[String(table)]:[row]}:{}
      const preserved=JSON.stringify(projection({id:'synthetic',[String(field)]:before}))===JSON.stringify(projection({id:'synthetic',[String(field)]:after}))
      const h=harness({sql:(frame,value)=>frame.name==='preservation'?{...(value as object),sourcePreserved:untargeted||preserved,originalsPreserved:!untargeted||preserved}:value})
      await expect(h.proof.sdk()).rejects.toThrow(/^attendance_session_proof_refused$/);await h.proof.settle();expect(h.proof.receipt().complete).toBe(false)
    }
  })
})
