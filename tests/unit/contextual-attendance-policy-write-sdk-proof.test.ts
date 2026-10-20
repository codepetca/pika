import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { createAttendancePolicyWriteSdkProof,assertAttendancePolicyWriteProofReceipt,type AttendancePolicyWriteProofControls } from '../../scripts/contextual-attendance-policy-write-sdk-proof'
import { attendancePolicyWriteSdkInventory,attendancePolicyWriteSqlDescriptors,newAttendancePolicyWriteFixture,type AttendancePolicyWriteSqlDescriptor } from '../../scripts/contextual-attendance-policy-write-native-fixture'

describe('attendance policy write SDK leaf (CPU only; never native verification)',()=>{
  const f=newAttendancePolicyWriteFixture('assignmentlist_012345abcdef'),calls=attendancePolicyWriteSdkInventory(f)
  const target={origin:'http://127.0.0.1:54331',serviceRoleKey:'synthetic-service-role-key'}
  beforeEach(()=>{
    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED','true');vi.stubEnv('PIKA_BARA_ATTENDANCE_SCOPE_MODE','teacher_entitlements')
    vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL','http://127.0.0.1:9');vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF','pika-attendance-write-proof')
    vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET','pika-attendance-policy-proof-synthetic-secret-v1')
  })
  afterEach(()=>vi.unstubAllEnvs())
  function harness(options:{alter?:(data:Record<string,unknown>,n:number)=>unknown;response?:()=>Response;sql?:(frame:AttendancePolicyWriteSqlDescriptor,value:unknown)=>unknown}={}){
    const events:string[]=[],saved=new Map<number,Record<string,unknown>>();let n=0,active=0,maximum=0
    const original:typeof fetch=vi.fn(async(url,init)=>{
      const index=n++,call=calls[index];events.push(`http:${call.label}`)
      expect(url).toBe(`${target.origin}/rest/v1/rpc/save_attendance_policy_for_owner_v1`);expect(init?.redirect).toBe('error');expect(JSON.parse(String(init?.body))).toEqual(call.args)
      const {expected_revision,...policy}=call.args.p_policy
      const dto={...policy,classroom_id:call.args.p_classroom_id,timezone:'America/Toronto',revision:(expected_revision??0)+1,updated_at:`2026-10-19T00:00:${String(index).padStart(2,'0')}.000Z`}
      if(call.status===200)saved.set(index,dto)
      const data:Record<string,unknown>=call.status===200?{actor_id:call.args.p_actor_id,classroom_id:call.args.p_classroom_id,scope_mode:call.args.p_scope_mode,policy:dto}
        :{code:`PT${call.status}`,message:'synthetic_expected_denial',details:null,hint:null}
      return options.response?.()??new Response(JSON.stringify(options.alter?options.alter(data,index):data),{status:call.status,headers:{'content-type':'application/json'}})
    })
    const controls:AttendancePolicyWriteProofControls={deadline:Date.now()+30000,cleanupDeadline:Date.now()+50000,
      guard:async()=>{events.push('guard')},account:vi.fn(),httpSession:value=>{active+=value?1:-1;maximum=Math.max(maximum,active)},
      sql:async frame=>{
        events.push(`sql:${frame.name}`)
        const value=frame.name==='witness'?{studentOwner:true,selfEnrollment:true,membershipGenerationRows:2,policyRows:0,nativeVerified:false}
          :frame.name==='preservation'?{sourcePreserved:true,originalsPreserved:true,nativeVerified:false}
          :frame.name.startsWith('observe-')?{case:calls[Number(frame.name.slice(8))].label,preserved:true,saved:saved.get(Number(frame.name.slice(8)))??null,nativeVerified:false}
          :{stage:frame.name,nativeVerified:false}
        return options.sql?options.sql(frame,value):value
      }}
    return{original,controls,events,proof:createAttendancePolicyWriteSdkProof(f,target,original,controls),active:()=>active,maximum:()=>maximum}
  }
  it('constructs inertly and uses the actual adapter plus installed SDK for all 16 finite calls',async()=>{
    const h=harness();expect(h.events).toEqual([]);expect(h.original).not.toHaveBeenCalled()
    const receipt=await h.proof.sdk();await h.proof.settle()
    expect(receipt).toMatchObject({complete:true,nativeVerified:false,requests:16,adapterRequests:13,rpcRequests:3,descriptorCalls:23,guardCalls:78,restoreState:'restored',sessions:0,unsettled:0,failed:false,poisoned:false})
    expect(receipt.physical.map(p=>p.status)).toEqual(calls.map(c=>c.status));expect(h.active()).toBe(0);expect(h.maximum()).toBe(1)
    for(let n=0;n<16;n++)expect(h.events.indexOf(`sql:observe-${n}`)).toBeGreaterThan(h.events.indexOf(`http:${calls[n].label}`))
    for(let n=0;n<h.events.length;n++)if(h.events[n].startsWith('sql:')||h.events[n].startsWith('http:')){expect(h.events[n-1]).toBe('guard');expect(h.events[n+1]).toBe('guard')}
    expect(()=>assertAttendancePolicyWriteProofReceipt({...receipt,nativeVerified:true})).toThrow()
    expect(()=>assertAttendancePolicyWriteProofReceipt({...receipt,physical:receipt.physical.slice(1)})).toThrow()
    expect(()=>assertAttendancePolicyWriteProofReceipt({...receipt,physical:receipt.physical.map(p=>({...p,status:200}))})).toThrow()
    expect(()=>assertAttendancePolicyWriteProofReceipt({...receipt,guardCalls:77})).toThrow()
  })
  it.each(['actor_id','classroom_id','scope_mode'])('rejects changed %s with one dispatch and restores under cleanup authority',async field=>{
    const h=harness({alter:data=>({...data,[field]:field==='scope_mode'?'exact_canary':f.actors[3].id})})
    await expect(h.proof.sdk()).rejects.toThrow(/^attendance_policy_write_proof_refused$/);await h.proof.settle()
    expect(h.original).toHaveBeenCalledTimes(1);expect(h.active()).toBe(0)
    expect(h.proof.receipt()).toMatchObject({failed:true,complete:false,restoreState:'restored',poisoned:false,nativeVerified:false})
    expect(h.events).toContain('sql:preservation')
  })
  it('rejects a DTO timestamp that does not match the fresh same-case database observation',async()=>{
    const h=harness({sql:(frame,value)=>frame.name==='observe-0'?{...(value as object),saved:{...((value as {saved:object}).saved),updated_at:'2026-10-19T00:01:00.000Z'}}:value})
    await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(1);expect(h.proof.receipt().restoreState).toBe('restored')
  })
  it.each(['revision','entry_opens_minutes_before'])('rejects wrong saved %s before accepting adapter evidence',async field=>{
    const h=harness({alter:data=>({...data,policy:{...(data.policy as object),[field]:999}})})
    await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(1)
  })
  it('accepts expected denial responses but rejects an incorrect denial envelope',async()=>{
    const h=harness({alter:(data,n)=>n===4?{...data,code:'PT403'}:data})
    await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(5);expect(h.active()).toBe(0)
  })
  it.each([302,500])('rejects unplanned HTTP %s and does not retry',async status=>{
    const h=harness({response:()=>new Response('private_error',{status,headers:{'content-type':'application/json'}})})
    await expect(h.proof.sdk()).rejects.toThrow(/^attendance_policy_write_proof_refused$/);await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(1)
  })
  it.each(['content-type','oversize','unknown-key'])('rejects invalid transport %s and closes its session',async mode=>{
    const h=harness(mode==='unknown-key'?{alter:data=>({...data,unknown:true})}:{response:()=>new Response(mode==='oversize'?'x'.repeat(16385):'{}',{headers:{'content-type':mode==='content-type'?'text/plain':'application/json'}})})
    await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.active()).toBe(0);expect(h.original).toHaveBeenCalledTimes(1)
  })
  it.each([0,1,3])('rejects incomplete generation binding count %s before HTTP',async count=>{
    const h=harness({sql:(frame,value)=>frame.name==='witness'?{...(value as object),membershipGenerationRows:count}:value})
    await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).not.toHaveBeenCalled();expect(h.proof.receipt().complete).toBe(false)
  })
  it('rejects negative graph drift immediately with full restoration',async()=>{
    const h=harness({sql:(frame,value)=>frame.name==='observe-4'?{...(value as object),preserved:false}:value})
    await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(5);expect(h.proof.receipt().restoreState).toBe('restored')
  })
  it('rejects preservation failure and refuses a replay without dispatching again',async()=>{
    const bad=harness({sql:(frame,value)=>frame.name==='preservation'?{...(value as object),originalsPreserved:false}:value})
    await expect(bad.proof.sdk()).rejects.toThrow();await bad.proof.settle();expect(bad.proof.receipt().complete).toBe(false)
    const h=harness();await h.proof.sdk();await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).toHaveBeenCalledTimes(16)
  })
  it('a wrong outer scope cannot send a substituted adapter request',async()=>{
    vi.stubEnv('PIKA_BARA_ATTENDANCE_SCOPE_MODE','exact_canary');const h=harness()
    await expect(h.proof.sdk()).rejects.toThrow();await h.proof.settle();expect(h.original).not.toHaveBeenCalled()
  })
  it('does not restore while native fetch closure is uncertain and does not extend the original cleanup clock',async()=>{
    const h=harness(),now=Date.now(),original:typeof fetch=vi.fn(()=>new Promise<Response>(()=>{}))
    const proof=createAttendancePolicyWriteSdkProof(f,target,original,{...h.controls,deadline:now+80,cleanupDeadline:now+160})
    await expect(proof.sdk()).rejects.toThrow(/^attendance_policy_write_proof_refused$/)
    expect(original).toHaveBeenCalledTimes(1)
    expect(proof.receipt()).toMatchObject({complete:false,failed:true,poisoned:true,restoreState:'prepared',sessions:1,nativeVerified:false})
    expect(proof.receipt().unsettled).toBeGreaterThan(0)
    expect(h.events).not.toContain('sql:restore-baseline')
  })
  // CPU source-plan oracle only. Complete-row projection is selected from the
  // admitted SQL; actual PostgreSQL/trigger evidence remains the outer run.
  it.each([
    ['private.pal_membership_generations','state','active','removed'],
    ['private.pal_membership_generations','pal_reference','reference-a','reference-b'],
    ['private.pal_membership_generations','scope_digest','scope-a','scope-b'],
    ['public.account_plans','plan_key','free','basic'],
    ['public.account_plan_audit','new_plan_key','free','basic'],
    ['public.effective_feature_entitlement_audit','reason_code','default_free_account_provisioning','drift'],
    ['public.attendance_principal_mappings','principal_ref','principal-a','principal-b'],
    ['public.attendance_integration_outbox','payload',{revision:1},{revision:2}],
    ['public.attendance_status_override_events','reason_code','reason-a','reason-b'],
    ['public.classroom_roster','retained_manual_attendance_marks',{day:'present'},{day:'absent'}],
  ])('rejects complete %s %s drift in both whole-row partitions',async(table,field,before,after)=>{
    const sql=attendancePolicyWriteSqlDescriptors(f).find(frame=>frame.name==='preservation')!.sql
    for(const untargeted of [false,true]){
      const projection=(row:unknown)=>sql.includes(`from ${table} r where ${untargeted?'not ':''}(`)?{[String(table)]:[row]}:{}
      const preserved=JSON.stringify(projection({id:'synthetic', [String(field)]:before}))===JSON.stringify(projection({id:'synthetic',[String(field)]:after}))
      const h=harness({sql:(frame,value)=>frame.name==='preservation'?{...(value as object),sourcePreserved:untargeted||preserved,originalsPreserved:!untargeted||preserved}:value})
      await expect(h.proof.sdk()).rejects.toThrow(/^attendance_policy_write_proof_refused$/);await h.proof.settle()
      expect(h.proof.receipt().complete).toBe(false)
    }
  })
})
