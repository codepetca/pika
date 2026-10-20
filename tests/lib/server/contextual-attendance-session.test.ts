import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { loadContextualAttendanceSession } from '@/lib/server/contextual-attendance-session'
const { integration,canary }=vi.hoisted(()=>({integration:vi.fn(),canary:vi.fn()}))
vi.mock('@/lib/server/bara-attendance-client',()=>({getBaraAttendanceIntegrationState:integration}))
vi.mock('@/lib/server/bara-attendance-canary',()=>({getBaraAttendanceCanaryScope:canary}))
const actorId='10000000-0000-4000-8000-000000000001',classroomId='20000000-0000-4000-8000-000000000001',classDate='2026-10-20'
const emptyRows=()=>({participants:[],occurrence:null,policy:null,session:null,check_ins:[],overrides:[],outbox:[]})
const snapshot=()=>({actor_id:actorId,classroom_id:classroomId,class_date:classDate,runtime_integration:'ready',scope_mode:'exact_canary',installation_ref:'test_installation',
  observed_at:'2026-10-20T14:00:00Z',status:'ok',integration:'ready',students:[{id:actorId,email:'a@example.invalid',first_name:'Owner',last_name:''}],rows:emptyRows()})
const envelope=(data:unknown)=>({data,error:null,status:200,statusText:'OK',count:null})
const rpc=vi.fn(),abortSignal=vi.fn()
const run=()=>loadContextualAttendanceSession({supabase:{rpc} as never,actorId,classroomId,classDate})
describe('contextual owner session read',()=>{
  beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('PIKA_BARA_ATTENDANCE_SCOPE_MODE','exact_canary');vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF','test_installation');integration.mockReturnValue('ready');canary.mockReturnValue({state:'ready',teacherId:actorId,classroomId});rpc.mockReturnValue({abortSignal});abortSignal.mockResolvedValue(envelope(snapshot()))})
  afterEach(()=>vi.unstubAllEnvs())
  it('makes exactly one actor/class/date/runtime/installation bound SDK read and preserves the DTO',async()=>{
    expect(await run()).toMatchObject({classroomId,classDate,integration:'not_configured',students:[{studentId:actorId,firstName:'Owner',lastName:'',status:'unmarked'}]})
    expect(rpc).toHaveBeenCalledExactlyOnceWith('read_attendance_session_for_owner_v1',{p_actor_id:actorId,p_classroom_id:classroomId,p_class_date:classDate,p_runtime_integration:'ready',p_scope_mode:'exact_canary',p_installation_ref:'test_installation',p_canary_actor_id:actorId,p_canary_classroom_id:classroomId})
  })
  it.each(['disabled','not_configured'])('still authorizes in SQL for runtime%s and preserves empty attendance roster',async state=>{
    integration.mockReturnValue(state);canary.mockReturnValue({state,teacherId:null,classroomId:null})
    abortSignal.mockResolvedValue(envelope({...snapshot(),runtime_integration:state,integration:state}))
    expect(await run()).toMatchObject({integration:state,students:[{studentId:actorId,status:'unmarked'}]});expect(rpc).toHaveBeenCalledOnce()
  })
  it.each(['forbidden','blocked'])('rejects authoritative%s without fallback or leaking rows',async status=>{
    abortSignal.mockResolvedValue(envelope({...snapshot(),status,integration:'disabled',students:[]}))
    await expect(run()).rejects.toMatchObject({statusCode:status==='forbidden'?403:503})
  })
  it.each(['actor_id','classroom_id','class_date','runtime_integration','scope_mode','installation_ref'])('rejects substituted%s',async field=>{
    abortSignal.mockResolvedValue(envelope({...snapshot(),[field]:'foreign'}));await expect(run()).rejects.toMatchObject({statusCode:503})
  })
  it('sanitizes unknown SQL errors and aborts without retry',async()=>{
    abortSignal.mockResolvedValue({data:null,error:{code:'42501',message:'private'},status:403,statusText:'Forbidden',count:null})
    await expect(run()).rejects.toMatchObject({statusCode:503,message:'Attendance is temporarily unavailable'});expect(rpc).toHaveBeenCalledOnce()
  })
  it('retains archived owner and mismatched-canary200 roster-only results',async()=>{
    abortSignal.mockResolvedValue(envelope({...snapshot(),integration:'disabled'}))
    expect(await run()).toMatchObject({integration:'disabled',students:[{studentId:actorId,status:'unmarked',hasQrCheckIn:false}]})
    canary.mockReturnValue({state:'ready',teacherId:'30000000-0000-4000-8000-000000000001',classroomId})
    expect(await run()).toMatchObject({integration:'disabled'})
    abortSignal.mockResolvedValue(envelope(snapshot()));await expect(run()).rejects.toMatchObject({statusCode:503})
  })
  it('uses existing entitlement scope without reading canary configuration',async()=>{
    vi.stubEnv('PIKA_BARA_ATTENDANCE_SCOPE_MODE','teacher_entitlements')
    abortSignal.mockResolvedValue(envelope({...snapshot(),scope_mode:'teacher_entitlements',integration:'disabled'}))
    expect(await run()).toMatchObject({integration:'disabled',students:[{studentId:actorId}]});expect(canary).not.toHaveBeenCalled()
    expect(rpc.mock.calls[0][1]).toMatchObject({p_canary_actor_id:null,p_canary_classroom_id:null})
  })
  it('keeps unconfigured installation/canary as an authorized200 roster read, never an early404',async()=>{
    vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF','');integration.mockReturnValue('not_configured');canary.mockReturnValue({state:'not_configured',teacherId:null,classroomId:null})
    abortSignal.mockResolvedValue(envelope({...snapshot(),runtime_integration:'not_configured',integration:'not_configured',installation_ref:null}))
    expect(await run()).toMatchObject({integration:'not_configured',students:[{studentId:actorId}]})
    expect(rpc.mock.calls[0][1]).toMatchObject({p_installation_ref:null,p_canary_actor_id:null,p_canary_classroom_id:null})
  })
  it('retains a complete1001-row result, fallback names and exact legacy email ordering',async()=>{
    const students=Array.from({length:1001},(_,n)=>({id:`10000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`,email:`student${1001-n}@example.invalid`,first_name:n?'':'Named',last_name:''}))
    abortSignal.mockResolvedValue(envelope({...snapshot(),students,integration:'disabled'}))
    const result=await run(),expected=[...students].sort((a,b)=>a.email.localeCompare(b.email)||a.id.localeCompare(b.id))
    expect(result.students).toHaveLength(1001);expect(result.students.map(r=>r.studentId)).toEqual(expected.map(r=>r.id));expect(result.students.filter(r=>r.firstName==='Named')).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('@example.invalid')
  })
  it.each([
    null,{}, {...snapshot(),extra:'private'}, {...snapshot(),students:[...snapshot().students,...snapshot().students]},
    {...snapshot(),students:[{...snapshot().students[0],workos_user_id:'private'}]},
    {...snapshot(),integration:'disabled',rows:{...emptyRows(),policy:{enabled:true}}},
    {...snapshot(),status:'forbidden'}, {...snapshot(),rows:{...emptyRows(),extra:'private'}},
    {...snapshot(),observed_at:'not-a-time'},
  ])('fails closed for widened/malformed/disclosing snapshot%#',async data=>{
    abortSignal.mockResolvedValue(envelope(data));await expect(run()).rejects.toMatchObject({statusCode:503})
  })
  it('does not retry an actual rejected or aborted SDK operation',async()=>{
    abortSignal.mockRejectedValue(Error('private_transport_failure'))
    await expect(run()).rejects.toMatchObject({statusCode:503,message:'Attendance is temporarily unavailable'});expect(rpc).toHaveBeenCalledOnce()
  })
})
