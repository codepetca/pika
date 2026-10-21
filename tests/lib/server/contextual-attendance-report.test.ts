import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadContextualAttendanceReport } from '@/lib/server/contextual-attendance-report'
import * as attendance from '@/lib/attendance'

const actorId='10000000-0000-4000-8000-000000000001',classroomId='20000000-0000-4000-8000-000000000001'
const student={id:actorId,email:'owner@example.invalid',first_name:'Owner',last_name:''}
const snapshot=()=>({actor_id:actorId,classroom_id:classroomId,observed_at:'2026-10-20T03:59:59Z',status:'ok',students:[student],
  class_days:['2026-10-18','2026-10-19','2026-10-20'].map(date=>({classroom_id:classroomId,date,is_class_day:true})),
  entries:[{id:'30000000-0000-4000-8000-000000000001',classroom_id:classroomId,student_id:actorId,date:'2026-10-18',text:'\u2003\uFEFF'}]})
const envelope=(data:unknown)=>({data,error:null,status:200,statusText:'OK',count:null})
const rpc=vi.fn(),abortSignal=vi.fn(),run=()=>loadContextualAttendanceReport({supabase:{rpc} as never,actorId,classroomId})
describe('contextual owner Daily Log attendance report',()=>{
  beforeEach(()=>{vi.clearAllMocks();rpc.mockReturnValue({abortSignal});abortSignal.mockResolvedValue(envelope(snapshot()))})
  afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs()})
  it('uses one bounded two-argument SDK snapshot and the existing Unicode/Toronto rules',async()=>{
    expect(await run()).toEqual({classroom_id:classroomId,dates:['2026-10-18','2026-10-19','2026-10-20'],attendance:[{
      student_id:actorId,student_email:student.email,student_first_name:'Owner',student_last_name:'',
      dates:{'2026-10-18':'absent','2026-10-19':'pending','2026-10-20':'pending'},summary:{present:0,absent:1},
    }]})
    expect(rpc).toHaveBeenCalledExactlyOnceWith('read_attendance_report_for_owner_v1',{p_actor_id:actorId,p_classroom_id:classroomId})
    expect(abortSignal).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal))
  })
  it('handles Toronto midnight, actual content, non-class days and never returns raw text',async()=>{
    const value=snapshot();value.observed_at='2026-10-20T04:00:00Z';value.entries[0].text='\u2003private content\uFEFF';value.class_days[2].is_class_day=false
    abortSignal.mockResolvedValue(envelope(value));const result=await run()
    expect(result.attendance[0]).toMatchObject({dates:{'2026-10-18':'present','2026-10-19':'absent'},summary:{present:1,absent:1}})
    expect(result.dates).toEqual(['2026-10-18','2026-10-19']);expect(JSON.stringify(result)).not.toContain('private content')
  })
  it.each(['forbidden','blocked'])('maps authoritative%s without disclosing data',async status=>{
    abortSignal.mockResolvedValue(envelope({...snapshot(),status,students:[],class_days:[],entries:[]}))
    await expect(run()).rejects.toMatchObject({statusCode:status==='forbidden'?403:503})
  })
  it('supports a complete empty report',async()=>{
    abortSignal.mockResolvedValue(envelope({...snapshot(),students:[],class_days:[],entries:[]}))
    expect(await run()).toEqual({classroom_id:classroomId,attendance:[],dates:[]})
  })
  it('does not consult disabled or unconfigured Bara runtime',async()=>{
    vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED','false');vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL','');vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET','')
    expect((await run()).attendance).toHaveLength(1);expect(rpc).toHaveBeenCalledOnce()
  })
  it('retains1001 students and exact email ordering with missing profile names',async()=>{
    const students=Array.from({length:1001},(_,n)=>({...student,id:`10000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`,email:`s${1001-n}@example.invalid`,first_name:'',last_name:''}))
    const class_days=Array.from({length:1001},(_,n)=>({classroom_id:classroomId,date:new Date(Date.UTC(2020,0,n+1)).toISOString().slice(0,10),is_class_day:true}))
    const entries=class_days.map((d,n)=>({id:`30000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`,classroom_id:classroomId,student_id:students[0].id,date:d.date,text:'present'}))
    abortSignal.mockResolvedValue(envelope({...snapshot(),students,class_days:[],entries:[]}));const result=await run()
    expect(result.attendance).toHaveLength(1001)
    expect(result.attendance.map(r=>r.student_id)).toEqual([...students].sort((a,b)=>a.email.localeCompare(b.email)||a.id.localeCompare(b.id)).map(r=>r.id))
    abortSignal.mockResolvedValue(envelope({...snapshot(),class_days,entries:entries.map(row=>({...row,student_id:actorId}))}))
    const longReport=await run();expect(longReport.dates).toHaveLength(1001);expect(longReport.attendance[0].summary.present).toBe(1001)
  })
  it.each([250000,250001])('bounds projected cells at%s before compute without truncation',async cells=>{
    const compute=vi.spyOn(attendance,'computeAttendanceRecords').mockReturnValue([])
    const class_days=Array.from({length:501},(_,n)=>({classroom_id:classroomId,date:new Date(Date.UTC(2020,0,n+1)).toISOString().slice(0,10),is_class_day:n<500}))
    const students=Array.from({length:500},(_,n)=>({...student,id:`10000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`}))
    //500×500 is exact;53×4717 is one over while the raw snapshot remains small.
    const value=cells===250000?{...snapshot(),students,class_days,entries:[]}:{...snapshot(),students:students.slice(0,53),class_days:Array.from({length:4717},(_,n)=>({classroom_id:classroomId,date:new Date(Date.UTC(2000,0,n+1)).toISOString().slice(0,10),is_class_day:true})),entries:[]}
    abortSignal.mockResolvedValue(envelope(value))
    if(cells===250000){await run();expect(compute).toHaveBeenCalledOnce()}else{await expect(run()).rejects.toMatchObject({statusCode:503});expect(compute).not.toHaveBeenCalled()}
  })
  it.each([32000000,32000001])('bounds roster×(entries+all days) comparisons before compute at%s',async comparisons=>{
    const compute=vi.spyOn(attendance,'computeAttendanceRecords').mockReturnValue([])
    const count=comparisons===32000000?3999:560,rosterSize=comparisons===32000000?8000:57041
    const students=Array.from({length:rosterSize},(_,n)=>({...student,id:`10000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`,email:'',first_name:''}))
    const entries=Array.from({length:count},(_,n)=>({id:`30000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`,classroom_id:classroomId,student_id:actorId,date:new Date(Date.UTC(2000,0,n+1)).toISOString().slice(0,10),text:''}))
    const class_days=[{classroom_id:classroomId,date:'2020-01-01',is_class_day:false}]
    expect(students.length*(entries.length+class_days.length)).toBe(comparisons)
    abortSignal.mockResolvedValue(envelope({...snapshot(),students,class_days,entries}))
    if(comparisons===32000000){await run();expect(compute).toHaveBeenCalledOnce()}else{await expect(run()).rejects.toMatchObject({statusCode:503});expect(compute).not.toHaveBeenCalled()}
  })
  it('rejects all-nonclass-day filter amplification with zero projected cells before compute',async()=>{
    const compute=vi.spyOn(attendance,'computeAttendanceRecords')
    const students=Array.from({length:10000},(_,n)=>({...student,id:`10000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`}))
    const class_days=Array.from({length:4000},(_,n)=>({classroom_id:classroomId,date:new Date(Date.UTC(2000,0,n+1)).toISOString().slice(0,10),is_class_day:false}))
    expect(students.length*class_days.filter(day=>day.is_class_day).length).toBe(0)
    abortSignal.mockResolvedValue(envelope({...snapshot(),students,class_days,entries:[]}))
    await expect(run()).rejects.toMatchObject({statusCode:503});expect(compute).not.toHaveBeenCalled()
  })
  it('rejects combined1001×1001 amplification before compute',async()=>{
    const compute=vi.spyOn(attendance,'computeAttendanceRecords')
    const students=Array.from({length:1001},(_,n)=>({...student,id:`10000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`}))
    const class_days=Array.from({length:1001},(_,n)=>({classroom_id:classroomId,date:new Date(Date.UTC(2020,0,n+1)).toISOString().slice(0,10),is_class_day:true}))
    abortSignal.mockResolvedValue(envelope({...snapshot(),students,class_days,entries:[]}))
    await expect(run()).rejects.toMatchObject({statusCode:503});expect(compute).not.toHaveBeenCalled()
  })
  it.each([8388608,8388609])('bounds complete raw UTF8 snapshot at%s bytes',async bytes=>{
    const compute=vi.spyOn(attendance,'computeAttendanceRecords')
    const value=snapshot();value.entries[0].text=''
    value.entries[0].text='x'.repeat(bytes-Buffer.byteLength(JSON.stringify(value),'utf8'))
    expect(Buffer.byteLength(JSON.stringify(value),'utf8')).toBe(bytes)
    abortSignal.mockResolvedValue(envelope(value))
    if(bytes===8388608){await run();expect(compute).toHaveBeenCalledOnce()}else{await expect(run()).rejects.toMatchObject({statusCode:503});expect(compute).not.toHaveBeenCalled()}
  })
  it('rejects a complete DTO over8MiB after a permitted bounded computation',async()=>{
    const compute=vi.spyOn(attendance,'computeAttendanceRecords')
    const students=Array.from({length:1000},(_,n)=>({...student,id:`10000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`,first_name:'x'.repeat(4000)}))
    const class_days=Array.from({length:250},(_,n)=>({classroom_id:classroomId,date:new Date(Date.UTC(2020,0,n+1)).toISOString().slice(0,10),is_class_day:true}))
    const value={...snapshot(),students,class_days,entries:[]};expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(8388608)
    abortSignal.mockResolvedValue(envelope(value));await expect(run()).rejects.toMatchObject({statusCode:503});expect(compute).toHaveBeenCalledOnce()
  })
  it.each([
    null,{}, {...snapshot(),private:'leak'}, {...snapshot(),actor_id:classroomId}, {...snapshot(),classroom_id:actorId},
    {...snapshot(),observed_at:'invalid'}, {...snapshot(),students:[student,student]},
    {...snapshot(),students:[{...student,workos_user_id:'private'}]}, {...snapshot(),status:'forbidden'},
    {...snapshot(),class_days:[{...snapshot().class_days[0],classroom_id:actorId}]},
    {...snapshot(),class_days:[snapshot().class_days[0],snapshot().class_days[0]]},
    {...snapshot(),entries:[{...snapshot().entries[0],student_id:classroomId}]},
    {...snapshot(),entries:[{...snapshot().entries[0],classroom_id:actorId}]},
    {...snapshot(),entries:[snapshot().entries[0],snapshot().entries[0]]},
    {...snapshot(),entries:[{...snapshot().entries[0],date:'2026-02-30'}]},
    {...snapshot(),entries:[{...snapshot().entries[0],text:null}]},
  ])('rejects malformed/widened/unbound snapshot%#',async data=>{
    abortSignal.mockResolvedValue(envelope(data));await expect(run()).rejects.toMatchObject({statusCode:503})
  })
  it.each(['resolved','rejected'])('sanitizes%s SDK errors without retry',async kind=>{
    if(kind==='resolved')abortSignal.mockResolvedValue({data:null,error:{code:'42501',message:'private'},status:403,statusText:'Forbidden',count:null})
    else abortSignal.mockRejectedValue(Error('private'))
    await expect(run()).rejects.toMatchObject({statusCode:503,message:'Attendance is temporarily unavailable'});expect(rpc).toHaveBeenCalledOnce()
  })
})
