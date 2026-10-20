import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET,POST } from '@/app/api/teacher/attendance/session/route'
import { ApiError } from '@/lib/api-error'
const {auth,role,load,legacy,owner}=vi.hoisted(()=>({auth:vi.fn(),role:vi.fn(),load:vi.fn(),legacy:vi.fn(),owner:vi.fn()}))
vi.mock('@/lib/auth',()=>({requireAuth:auth,requireRole:role}))
vi.mock('@/lib/supabase',()=>({getServiceRoleClient:()=>({})}))
vi.mock('@/lib/server/contextual-attendance-session',()=>({loadContextualAttendanceSession:load}))
vi.mock('@/lib/server/bara-attendance-view',async original=>({...await original<typeof import('@/lib/server/bara-attendance-view')>(),loadTeacherAttendanceView:legacy}))
vi.mock('@/lib/server/classrooms',()=>({assertTeacherOwnsClassroom:owner,assertTeacherCanMutateClassroom:vi.fn()}))
const actorId='10000000-0000-4000-8000-000000000001',classroomId='20000000-0000-4000-8000-000000000001'
const request=()=>new NextRequest(`http://localhost/api/teacher/attendance/session?classroom_id=${classroomId}&date=2026-10-20`)
describe('admitted GET session only',()=>{
  beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION',JSON.stringify({version:1,admittedUserIds:[actorId]}));auth.mockResolvedValue({id:actorId,role:'student'});role.mockResolvedValue({id:actorId,role:'teacher'});load.mockResolvedValue({integration:'disabled',students:[]});owner.mockResolvedValue({ok:true,classroom:{archived_at:null}});legacy.mockResolvedValue({integration:'disabled',students:[]})})
  afterEach(()=>vi.unstubAllEnvs())
  it.each(['teacher','student'])('admits%s-valued owner without invoking legacy guards',async label=>{
    auth.mockResolvedValue({id:actorId,role:label});const response=await GET(request())
    expect(response.status).toBe(200);expect(await response.json()).toEqual({integration:'disabled',students:[]})
    expect(load).toHaveBeenCalledExactlyOnceWith({supabase:{},actorId,classroomId,classDate:'2026-10-20'})
    expect(role).not.toHaveBeenCalled();expect(owner).not.toHaveBeenCalled();expect(legacy).not.toHaveBeenCalled()
  })
  it.each([403,503])('does not fall back on authoritative%i',async status=>{load.mockRejectedValue(new ApiError(status,'Unavailable'));expect((await GET(request())).status).toBe(status);expect(legacy).not.toHaveBeenCalled();expect(role).not.toHaveBeenCalled()})
  it('preserves unmatched legacy GET and archived200 disabled behavior',async()=>{
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION','{"version":1,"admittedUserIds":[]}');owner.mockResolvedValue({ok:true,classroom:{archived_at:'2026-10-19T00:00:00Z'}})
    expect((await GET(request())).status).toBe(200);expect(role).toHaveBeenCalledWith('teacher');expect(legacy).toHaveBeenCalledWith({supabase:{},classroomId,classDate:'2026-10-20',integration:'disabled'});expect(load).not.toHaveBeenCalled()
  })
  it('retains absent-admission authentication before validation and never admits POST',async()=>{
    delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION;role.mockRejectedValue(new ApiError(403,'Forbidden'))
    expect((await GET(new NextRequest('http://localhost/api/teacher/attendance/session'))).status).toBe(403);expect(auth).not.toHaveBeenCalled()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION',JSON.stringify({version:1,admittedUserIds:[actorId]}))
    expect((await POST(new NextRequest('http://localhost/api/teacher/attendance/session',{method:'POST',body:'{}'}))).status).toBe(403)
    expect(auth).not.toHaveBeenCalled();expect(load).not.toHaveBeenCalled()
  })
  it('rejects malformed admission and widened queries',async()=>{
    expect((await GET(new NextRequest(request().url+'&actorId=foreign'))).status).toBe(400);expect(load).not.toHaveBeenCalled()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION','{bad');expect((await GET(request())).status).toBe(503);expect(role).not.toHaveBeenCalled()
  })
})
