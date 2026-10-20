import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
import {GET} from '@/app/api/teacher/attendance/route'
import {ApiError} from '@/lib/api-error'
const {auth,role,load,owner,days,roster,entries}=vi.hoisted(()=>({auth:vi.fn(),role:vi.fn(),load:vi.fn(),owner:vi.fn(),days:vi.fn(),roster:vi.fn(),entries:vi.fn()}))
vi.mock('@/lib/auth',()=>({requireAuth:auth,requireRole:role}))
vi.mock('@/lib/supabase',()=>({getServiceRoleClient:()=>({})}))
vi.mock('@/lib/server/contextual-attendance-report',async original=>({...await original<typeof import('@/lib/server/contextual-attendance-report')>(),loadContextualAttendanceReport:load}))
vi.mock('@/lib/server/classrooms',()=>({assertTeacherOwnsClassroom:owner}))
vi.mock('@/lib/server/attendance-report',()=>({loadAttendanceClassDays:days,loadAttendanceRoster:roster,loadAttendanceEntries:entries}))
const actorId='10000000-0000-4000-8000-000000000001',classroomId='20000000-0000-4000-8000-000000000001'
const request=()=>new NextRequest(`http://localhost/api/teacher/attendance?classroom_id=${classroomId}`)
describe('admitted report GET only',()=>{
  beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION',JSON.stringify({version:1,admittedUserIds:[actorId]}));auth.mockResolvedValue({id:actorId,role:'student'});role.mockResolvedValue({id:actorId,role:'teacher'});load.mockResolvedValue({attendance:[],dates:[],classroom_id:classroomId});owner.mockResolvedValue({ok:true,classroom:{archived_at:'2026-10-20T00:00:00Z'}});days.mockResolvedValue({rows:[],error:null});roster.mockResolvedValue({students:[],studentIds:[]});entries.mockResolvedValue({rows:[],error:null})})
  afterEach(()=>vi.unstubAllEnvs())
  it.each(['student','teacher'])('admits%s-valued actual owner and preserves DTO',async label=>{
    auth.mockResolvedValue({id:actorId,role:label});const response=await GET(request());expect(response.status).toBe(200)
    expect(await response.json()).toEqual({attendance:[],dates:[],classroom_id:classroomId})
    expect(load).toHaveBeenCalledExactlyOnceWith({supabase:{},actorId,classroomId});expect(role).not.toHaveBeenCalled();expect(owner).not.toHaveBeenCalled()
  })
  it.each([403,503])('retains authoritative%i without legacy fallback',async status=>{
    load.mockRejectedValue(new ApiError(status,'Unavailable'));expect((await GET(request())).status).toBe(status);expect(role).not.toHaveBeenCalled();expect(days).not.toHaveBeenCalled()
  })
  it('preserves unmatched legacy including archived owner200',async()=>{
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION','{"version":1,"admittedUserIds":[]}')
    expect((await GET(request())).status).toBe(200);expect(role).toHaveBeenCalledWith('teacher');expect(load).not.toHaveBeenCalled();expect(entries).toHaveBeenCalled()
  })
  it('authenticates before validation without admission',async()=>{
    delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION;role.mockRejectedValue(new ApiError(403,'Forbidden'))
    expect((await GET(new NextRequest('http://localhost/api/teacher/attendance'))).status).toBe(403);expect(auth).not.toHaveBeenCalled()
  })
  it('rejects client actor/extra keys and malformed admission',async()=>{
    expect((await GET(new NextRequest(request().url+'&actor_id=foreign'))).status).toBe(400);expect(load).not.toHaveBeenCalled()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION','{bad');expect((await GET(request())).status).toBe(503)
  })
})
