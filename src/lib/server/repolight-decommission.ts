import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { erasureReceiptSchema, type ErasureRequest } from '@/lib/contracts/repolight/service/contract'

const uuid=z.string().uuid(),ref=z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/)
const scopeSchema=z.object({teacherId:uuid,classroomId:uuid.optional(),studentId:uuid.optional(),assignmentId:uuid.optional()}).strict()
const bindingSchema=z.object({id:uuid,intent_id:uuid,teacher_id:uuid,classroom_id:uuid.nullable(),student_id:uuid.nullable(),assignment_id:uuid.nullable(),connection_ref:ref,workspace_ref:ref,installation_ref:ref,subject_ref:ref,state:z.enum(['active','erasing','erased']),operation_id:uuid.nullable(),receipt:z.unknown().nullable()}).passthrough()
export type RepoLightCleanupScope=z.infer<typeof scopeSchema>
export type RepoLightCleanupBinding=z.infer<typeof bindingSchema>
export class RepoLightDecommissionError extends Error {
  constructor(readonly code:'repolight_cleanup_pending'|'repolight_cleanup_binding_invalid'|'repolight_cleanup_unavailable',readonly retryable=false){super(code);this.name='RepoLightDecommissionError'}
}
function invalid():never{throw new RepoLightDecommissionError('repolight_cleanup_binding_invalid')}
function binding(raw:unknown,scope:RepoLightCleanupScope,allowErased=false):RepoLightCleanupBinding{
  const parsed=bindingSchema.safeParse(raw)
  if(!parsed.success||parsed.data.teacher_id!==scope.teacherId||(!allowErased&&parsed.data.state==='erased')||(!(allowErased&&parsed.data.state==='erased')&&((scope.classroomId&&parsed.data.classroom_id!==scope.classroomId)||(scope.studentId&&parsed.data.student_id!==scope.studentId)||(scope.assignmentId&&parsed.data.assignment_id!==scope.assignmentId))))invalid()
  return parsed.data
}
/** The database owns intent/authority and absence. This bounded coordinator owns
 * only the authenticated provider request; it never deletes local report facts.
 * No Analyze activation flag may turn retained subjects into false completion. */
export function createRepoLightDecommission(dependencies:{
  read:(scope:RepoLightCleanupScope)=>Promise<unknown>
  reserve:(scope:RepoLightCleanupScope,binding:RepoLightCleanupBinding,operationId:string)=>Promise<unknown>
  erase:(binding:RepoLightCleanupBinding,request:ErasureRequest)=>Promise<unknown>
  record:(scope:RepoLightCleanupScope,binding:RepoLightCleanupBinding,operationId:string,receipt:z.infer<typeof erasureReceiptSchema>)=>Promise<unknown>
  operationId?:()=>string
  requireReservedOperation?:boolean
}){
  return {async advance(input:RepoLightCleanupScope,options:{maxSubjects?:number}={}){
    const scope=scopeSchema.parse(input),limit=Math.max(1,Math.min(5,Math.floor(options.maxSubjects??3)))
    let raw:unknown
    try{raw=await dependencies.read(scope)}catch{throw new RepoLightDecommissionError('repolight_cleanup_pending',true)}
    if(!Array.isArray(raw)||raw.length>10000)invalid()
    const subjects=raw.map(row=>binding(row,scope))
    if(new Set(subjects.map(row=>row.id)).size!==subjects.length)invalid()
    let erased=0
    for(const before of subjects.slice(0,limit)){
      if(dependencies.requireReservedOperation&&!before.operation_id)invalid()
      const operation=before.operation_id??(dependencies.operationId??randomUUID)()
      try{
        const reserved=binding(await dependencies.reserve(scope,before,operation),scope,true)
        if(['id','intent_id','connection_ref','workspace_ref','installation_ref','subject_ref'].some(key=>reserved[key]!==before[key])||reserved.operation_id!==operation)invalid()
        const request:ErasureRequest={schemaVersion:'1.0',operationRef:operation,installationRef:reserved.installation_ref,subjectRef:reserved.subject_ref}
        const response=reserved.state==='erased'?reserved.receipt:await dependencies.erase(reserved,request)
        const parsed=erasureReceiptSchema.safeParse(response)
        if(!parsed.success||parsed.data.operationRef!==operation||parsed.data.installationRef!==reserved.installation_ref||parsed.data.subjectRef!==reserved.subject_ref)invalid()
        const completed=bindingSchema.safeParse(await dependencies.record(scope,reserved,operation,parsed.data))
        const recorded=completed.success?erasureReceiptSchema.safeParse(completed.data.receipt):null
        if(!completed.success||completed.data.id!==before.id||completed.data.teacher_id!==scope.teacherId||completed.data.state!=='erased'||completed.data.operation_id!==operation||!recorded?.success||JSON.stringify(recorded.data)!==JSON.stringify(parsed.data))invalid()
        erased+=1
      }catch(error){if(error instanceof RepoLightDecommissionError)throw error;throw new RepoLightDecommissionError('repolight_cleanup_pending',true)}
    }
    // Re-enumerate after writes: a concurrent Analyze can persist another subject.
    // Local destructive RPCs also retain their independent binding fence.
    let remaining: unknown
    try { remaining = await dependencies.read(scope) } catch {
      throw new RepoLightDecommissionError('repolight_cleanup_pending', true)
    }
    if (!Array.isArray(remaining) || remaining.length > 10000) invalid()
    const pending = remaining.map(row => binding(row, scope))
    if (new Set(pending.map(row => row.id)).size !== pending.length) invalid()
    return { complete: pending.length === 0, erased, pending: pending.length }
  }}
}
