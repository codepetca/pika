import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
import {POST} from '@/app/api/teacher/classrooms/reorder/route'
import {ApiError} from '@/lib/api-error'
const {auth,role,reorder,legacy}=vi.hoisted(()=>({auth:vi.fn(),role:vi.fn(),reorder:vi.fn(),legacy:vi.fn()}))
vi.mock('@/lib/auth',()=>({requireAuth:auth,requireRole:role}))
vi.mock('@/lib/supabase',()=>({getServiceRoleClient:()=>({})}))
vi.mock('@/lib/server/classroom-order',()=>({getNextTeacherClassroomPosition:legacy}))
vi.mock('@/lib/server/contextual-classroom-list-reorder',async original=>({...await original<typeof import('@/lib/server/contextual-classroom-list-reorder')>(),reorderContextualClassroomList:reorder}))
const actorId='10000000-0000-4000-8000-000000000001',classroomIds=['20000000-0000-4000-8000-000000000001']
const request=(body:unknown={classroom_ids:classroomIds})=>new NextRequest('http://localhost/api/teacher/classrooms/reorder',{method:'POST',body:JSON.stringify(body)})
describe('configured atomic reorder admission and compatible legacy adoption',()=>{
  beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION',JSON.stringify({version:1,admittedUserIds:[actorId]}));auth.mockResolvedValue({id:actorId,role:'student'});role.mockResolvedValue({id:actorId,role:'teacher'});reorder.mockResolvedValue(undefined);legacy.mockResolvedValue(null)})
  afterEach(()=>vi.unstubAllEnvs())
  it.each(['teacher','student'])('admits%s-valued owner with unchanged successDTO',async label=>{
    auth.mockResolvedValue({id:actorId,role:label});const response=await POST(request());expect(response.status).toBe(200);expect(await response.json()).toEqual({success:true})
    expect(reorder).toHaveBeenCalledExactlyOnceWith({supabase:{},actorId,classroomIds});expect(role).not.toHaveBeenCalled();expect(legacy).not.toHaveBeenCalled()
  })
  it('requires teacher for configured unmatched users but uses the same atomic writer',async()=>{
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION','{"version":1,"admittedUserIds":[]}')
    expect((await POST(request())).status).toBe(200);expect(role).toHaveBeenCalledWith('teacher');expect(reorder).toHaveBeenCalledOnce();expect(legacy).not.toHaveBeenCalled()
    role.mockRejectedValue(new ApiError(403,'Forbidden'));expect((await POST(request())).status).toBe(403);expect(reorder).toHaveBeenCalledOnce()
  })
  it('retains the complete absent-admission legacy migration check',async()=>{
    delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    expect((await POST(request())).status).toBe(409);expect(role).toHaveBeenCalledWith('teacher');expect(legacy).toHaveBeenCalledOnce();expect(auth).not.toHaveBeenCalled();expect(reorder).not.toHaveBeenCalled()
  })
  it.each([{}, {classroom_ids:['bad']},{classroom_ids:null},{classroom_ids:[null]},{classroom_ids:[classroomIds]},
    {classroom_ids:[...classroomIds,...classroomIds]},{classroom_ids:classroomIds,actor_id:actorId}])('rejects invalid/widened body%#',async body=>{
    expect((await POST(request(body))).status).toBe(400);expect(reorder).not.toHaveBeenCalled()
  })
  it('fails malformed admission closed before mutation',async()=>{
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION','{bad');expect((await POST(request())).status).toBe(503);expect(reorder).not.toHaveBeenCalled();expect(role).not.toHaveBeenCalled()
  })
  it.each([400,403,409,503])('retains authoritative%i without old-writer fallback',async status=>{
    reorder.mockRejectedValue(new ApiError(status,'Unavailable'));expect((await POST(request())).status).toBe(status);expect(legacy).not.toHaveBeenCalled()
  })
})
