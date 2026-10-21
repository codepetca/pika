import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import type { getServiceRoleClient } from '@/lib/supabase'
import { contextualClassroomListReorderIdentitySchema,contextualClassroomListOrderSchema } from '@/lib/validations/contextual-classroom-list-reorder'

const successSchema=z.object({data:z.object({actor_id:z.string().uuid(),classroom_ids:contextualClassroomListOrderSchema,reordered:z.literal(true)}).strict(),
  error:z.null(),status:z.number().int().min(200).max(299),statusText:z.string(),count:z.union([z.null(),z.literal(1)])}).strict()
const failureSchema=z.object({data:z.null(),error:z.object({code:z.string(),message:z.string(),details:z.string().nullable(),hint:z.string().nullable()}).strict(),
  status:z.number().int().min(400).max(599),statusText:z.string(),count:z.null()}).strict()
const unavailable=()=>new ApiError(503,'Unable to verify classroom order; refresh to reconcile its outcome')

/** One atomic write, no retry. A lost/malformed response never certifies rollback. */
export async function reorderContextualClassroomList(input:{supabase:ReturnType<typeof getServiceRoleClient>;actorId:string;classroomIds:string[]}) {
  const identity=contextualClassroomListReorderIdentitySchema.parse({actorId:input.actorId,classroomIds:input.classroomIds})
  let response:unknown
  try {
    response=await input.supabase.rpc('reorder_classrooms_for_owner_v1',{p_actor_id:identity.actorId,p_classroom_ids:identity.classroomIds})
      .abortSignal(AbortSignal.timeout(10_000))
  } catch {throw unavailable()}
  const failure=failureSchema.safeParse(response)
  if(failure.success){
    const {code,message}=failure.data.error
    if(code==='PT400'&&message==='classroom_list_reorder_invalid_request')throw new ApiError(400,'Invalid classroom order')
    if(code==='PT400'&&message==='classroom_list_reorder_invalid_set')throw new ApiError(400,'classroom_ids must include every active classroom exactly once')
    if(code==='PT403'&&message==='classroom_list_reorder_forbidden')throw new ApiError(403,'Forbidden')
    if(code==='PT409'&&message==='classroom_list_reorder_busy')throw new ApiError(409,'Classrooms changed; refresh and try again')
    throw unavailable()
  }
  const success=successSchema.safeParse(response)
  if(!success.success||success.data.data.actor_id!==identity.actorId
    ||JSON.stringify(success.data.data.classroom_ids)!==JSON.stringify(identity.classroomIds))throw unavailable()
}
