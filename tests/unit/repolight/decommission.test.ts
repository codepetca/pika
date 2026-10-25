import { describe, expect, it, vi } from 'vitest'
import { createRepoLightDecommission, RepoLightDecommissionError } from '@/lib/server/repolight-decommission'

const teacherId='f2930000-0000-4000-8000-000000000001',classroomId='f2930000-0000-4000-8000-000000000010',studentId='f2930000-0000-4000-8000-000000000002'
const operation='f2930000-0000-4000-8000-000000000070'
const binding=()=>({id:'f2930000-0000-4000-8000-000000000090',intent_id:'f2930000-0000-4000-8000-000000000040',teacher_id:teacherId,classroom_id:classroomId,student_id:studentId,assignment_id:'f2930000-0000-4000-8000-000000000020',connection_ref:'saved_connection',workspace_ref:'customer_fixture',installation_ref:'pika_fixture',subject_ref:'opaque_subject',state:'active',operation_id:null,receipt:null})
const receipt=()=>({schemaVersion:'1.0',operationRef:operation,installationRef:'pika_fixture',subjectRef:'opaque_subject',status:'erased',absenceVerified:true})
function dependencies() {
  const before=binding(),reserved={...before,state:'erasing',operation_id:operation}
  return {read:vi.fn().mockResolvedValueOnce([before]).mockResolvedValue([]),reserve:vi.fn().mockResolvedValue(reserved),erase:vi.fn().mockResolvedValue(receipt()),record:vi.fn().mockResolvedValue({...reserved,state:'erased',receipt:receipt(),classroom_id:null,student_id:null,assignment_id:null}),operationId:()=>operation}
}
describe('bounded RepoLight subject decommission',()=>{
  it('persists the subject erasure before egress, including unknown initial create outcomes',async()=>{
    const deps=dependencies(),result=await createRepoLightDecommission(deps).advance({teacherId,classroomId,studentId})
    expect(result).toEqual({complete:true,erased:1,pending:0})
    expect(deps.reserve.mock.invocationCallOrder[0]).toBeLessThan(deps.erase.mock.invocationCallOrder[0])
    expect(deps.erase.mock.invocationCallOrder[0]).toBeLessThan(deps.record.mock.invocationCallOrder[0])
    expect(deps.erase).toHaveBeenCalledWith(expect.objectContaining({connection_ref:'saved_connection'}),{schemaVersion:'1.0',operationRef:operation,installationRef:'pika_fixture',subjectRef:'opaque_subject'})
  })
  it('reuses a persisted operation after uncertain responses without a new feature gate',async()=>{
    const deps=dependencies();deps.read.mockReset().mockResolvedValueOnce([{...binding(),state:'erasing',operation_id:operation}]).mockResolvedValueOnce([{...binding(),state:'erasing',operation_id:operation}]).mockResolvedValue([]);deps.erase.mockRejectedValueOnce(new Error('private upstream content'))
    await expect(createRepoLightDecommission(deps).advance({teacherId,classroomId,studentId})).rejects.toMatchObject({code:'repolight_cleanup_pending',retryable:true})
    expect(deps.record).not.toHaveBeenCalled()
    await expect(createRepoLightDecommission(deps).advance({teacherId,classroomId,studentId})).resolves.toMatchObject({complete:true})
    expect(deps.reserve).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),operation)
  })
  it('rejects foreign bindings and malformed/uncertain receipts before recording completion',async()=>{
    const foreign=dependencies();foreign.read.mockReset().mockResolvedValue([{...binding(),student_id:'f2930000-0000-4000-8000-000000000003'}])
    await expect(createRepoLightDecommission(foreign).advance({teacherId,classroomId,studentId})).rejects.toBeInstanceOf(RepoLightDecommissionError)
    expect(foreign.erase).not.toHaveBeenCalled()
    const wrong=dependencies();wrong.erase.mockResolvedValue({...receipt(),subjectRef:'another_subject'})
    await expect(createRepoLightDecommission(wrong).advance({teacherId,classroomId,studentId})).rejects.toMatchObject({code:'repolight_cleanup_binding_invalid'})
    expect(wrong.record).not.toHaveBeenCalled()
  })
  it('bounds each tick and reports remaining durable subjects rather than claiming completion',async()=>{
    const deps=dependencies();deps.read.mockReset().mockResolvedValueOnce([binding(),{...binding(),id:'f2930000-0000-4000-8000-000000000091',subject_ref:'second_subject'}]).mockResolvedValue([{...binding(),id:'f2930000-0000-4000-8000-000000000091',subject_ref:'second_subject'}])
    expect(await createRepoLightDecommission(deps).advance({teacherId,classroomId,studentId},{maxSubjects:1})).toEqual({complete:false,erased:1,pending:1})
    expect(deps.erase).toHaveBeenCalledOnce()
  })
  it('keeps a concurrently created subject pending after the provider receipts are recorded', async () => {
    const deps = dependencies()
    deps.read.mockReset().mockResolvedValueOnce([binding()]).mockResolvedValue([{ ...binding(), id: 'f2930000-0000-4000-8000-000000000091', subject_ref: 'concurrent_subject' }])
    expect(await createRepoLightDecommission(deps).advance({ teacherId, classroomId })).toEqual({ complete: false, erased: 1, pending: 1 })
  })
  it('treats only database-enumerated absence as complete and does not hide invalid configuration behind a disabled flag',async()=>{
    const deps=dependencies();deps.read.mockReset().mockResolvedValue([])
    expect(await createRepoLightDecommission(deps).advance({teacherId,classroomId})).toEqual({complete:true,erased:0,pending:0})
    expect(deps.erase).not.toHaveBeenCalled()
    deps.read.mockReset().mockResolvedValue([binding()]);deps.erase.mockRejectedValue(new Error('not configured'))
    await expect(createRepoLightDecommission(deps).advance({teacherId,classroomId})).rejects.toMatchObject({code:'repolight_cleanup_pending'})
  })
})
