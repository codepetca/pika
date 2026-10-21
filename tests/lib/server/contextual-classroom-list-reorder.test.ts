import {beforeEach,describe,expect,it,vi} from 'vitest'
import {reorderContextualClassroomList} from '@/lib/server/contextual-classroom-list-reorder'
const actorId='10000000-0000-4000-8000-000000000001',classroomIds=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002']
const rpc=vi.fn(),abortSignal=vi.fn(),run=()=>reorderContextualClassroomList({supabase:{rpc} as never,actorId,classroomIds})
const envelope=(data:unknown)=>({data,error:null,status:200,statusText:'OK',count:null})
describe('atomic contextual classroom list reorder',()=>{
  beforeEach(()=>{vi.clearAllMocks();rpc.mockReturnValue({abortSignal});abortSignal.mockResolvedValue(envelope({actor_id:actorId,classroom_ids:classroomIds,reordered:true}))})
  it('uses exactly one bounded actor/order-bound SDK write',async()=>{
    await expect(run()).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledExactlyOnceWith('reorder_classrooms_for_owner_v1',{p_actor_id:actorId,p_classroom_ids:classroomIds})
    expect(abortSignal).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal))
  })
  it.each([0,4096,4097])('applies the private complete-set wire bound at%s without truncation',async count=>{
    const ids=Array.from({length:count},(_,n)=>`20000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`)
    abortSignal.mockResolvedValue(envelope({actor_id:actorId,classroom_ids:ids,reordered:true}))
    const operation=()=>reorderContextualClassroomList({supabase:{rpc} as never,actorId,classroomIds:ids})
    if(count<=4096){await operation();expect(rpc.mock.calls[0][1].p_classroom_ids).toHaveLength(count)}else{await expect(operation()).rejects.toThrow();expect(rpc).not.toHaveBeenCalled()}
  })
  it.each([
    ['PT400','invalid_request',400],['PT400','invalid_set',400],['PT403','forbidden',403],['PT409','busy',409],['PT503','fenced',503],['PT503','postcondition_failed',503],
  ])('maps only exact established%s/%s',async(code,label,status)=>{
    abortSignal.mockResolvedValue({data:null,error:{code,message:`classroom_list_reorder_${label}`,details:null,hint:null},status:Number(status),statusText:'Error',count:null})
    await expect(run()).rejects.toMatchObject({statusCode:status});expect(rpc).toHaveBeenCalledOnce()
  })
  it.each([null,{}, {actor_id:actorId,classroom_ids:classroomIds,reordered:false},
    {actor_id:classroomIds[0],classroom_ids:classroomIds,reordered:true},{actor_id:actorId,classroom_ids:[...classroomIds].reverse(),reordered:true},
    {actor_id:actorId,classroom_ids:classroomIds,reordered:true,private:'leak'},
  ])('rejects malformed/substituted success%# without retry',async data=>{
    abortSignal.mockResolvedValue(envelope(data));await expect(run()).rejects.toMatchObject({statusCode:503});expect(rpc).toHaveBeenCalledOnce()
  })
  it.each(['resolved','rejected'])('sanitizes%s unknown failure without certifying rollback or retry',async kind=>{
    if(kind==='resolved')abortSignal.mockResolvedValue({data:null,error:{code:'42501',message:'private'},status:403,statusText:'Forbidden',count:null})
    else abortSignal.mockRejectedValue(Error('private'))
    await expect(run()).rejects.toMatchObject({statusCode:503,message:expect.not.stringContaining('private')});expect(rpc).toHaveBeenCalledOnce()
  })
})
