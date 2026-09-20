import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import type { TableRow } from '@/types/database'
import type { Json } from '@/types/database.generated'

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const materialSuccessSchema = z.object({
  ok: z.literal(true),
  material: z.object({
    id: canonicalUuid,
    classroom_id: canonicalUuid,
    created_by: canonicalUuid,
    position: z.number().int().nonnegative(),
  }).passthrough(),
}).strip()
const surveySuccessSchema = z.object({
  ok: z.literal(true),
  survey: z.object({
    id: canonicalUuid,
    classroom_id: canonicalUuid,
    created_by: canonicalUuid,
    position: z.number().int().nonnegative(),
  }).passthrough(),
}).strip()

type RpcError = { code?: string; message?: string; details?: string }

type MaterialCreationClient = {
  rpc: (
    name: 'create_classwork_material_for_owner_v1',
    args: {
      p_actor_id: string
      p_classroom_id: string
      p_title: string
      p_content: Json
      p_is_draft: boolean
    },
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>
}

type SurveyCreationClient = {
  rpc: (
    name: 'create_survey_for_owner_v1',
    args: {
      p_actor_id: string
      p_classroom_id: string
      p_title: string
      p_show_results: boolean
      p_dynamic_responses: boolean
    },
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>
}

function mapRpcError(error: RpcError): never {
  if (error.code === 'P0002') throw new ApiError(404, 'Classroom not found')
  if (error.code === '42501') throw new ApiError(403, 'Unauthorized')
  if (error.code === '55000') throw new ApiError(403, 'Classroom is archived')
  if (isRetryableDatabaseContention(error)) {
    throw new ApiError(409, 'Classroom changed during this update. Refresh and try again.')
  }
  if (error.code === '22023' || error.code === '22P02' || error.code === '23502') {
    throw new ApiError(400, 'Invalid classwork creation request')
  }
  throw new ApiError(503, 'Unable to create classwork')
}

function parseContext(actorId: string, classroomId: string) {
  const actor = canonicalUuid.safeParse(actorId)
  const classroom = canonicalUuid.safeParse(classroomId)
  if (!actor.success || !classroom.success) {
    throw new ApiError(400, 'Invalid classwork creation request')
  }
  return { actorId: actor.data, classroomId: classroom.data }
}

export async function createClassworkMaterialForOwner(input: {
  supabase: MaterialCreationClient
  actorId: string
  classroomId: string
  title: string
  content: Json
  isDraft: boolean
}): Promise<TableRow<'classwork_materials'>> {
  const context = parseContext(input.actorId, input.classroomId)
  const { data, error } = await input.supabase.rpc('create_classwork_material_for_owner_v1', {
    p_actor_id: context.actorId,
    p_classroom_id: context.classroomId,
    p_title: input.title,
    p_content: input.content,
    p_is_draft: input.isDraft,
  })
  if (error) mapRpcError(error)

  const parsed = materialSuccessSchema.safeParse(data)
  if (
    !parsed.success
    || parsed.data.material.classroom_id !== context.classroomId
    || parsed.data.material.created_by !== context.actorId
  ) {
    throw new ApiError(503, 'Unable to verify material creation')
  }
  return parsed.data.material as TableRow<'classwork_materials'>
}

export async function createSurveyForOwner(input: {
  supabase: SurveyCreationClient
  actorId: string
  classroomId: string
  title: string
  showResults: boolean
  dynamicResponses: boolean
}): Promise<TableRow<'surveys'>> {
  const context = parseContext(input.actorId, input.classroomId)
  const { data, error } = await input.supabase.rpc('create_survey_for_owner_v1', {
    p_actor_id: context.actorId,
    p_classroom_id: context.classroomId,
    p_title: input.title,
    p_show_results: input.showResults,
    p_dynamic_responses: input.dynamicResponses,
  })
  if (error) mapRpcError(error)

  const parsed = surveySuccessSchema.safeParse(data)
  if (
    !parsed.success
    || parsed.data.survey.classroom_id !== context.classroomId
    || parsed.data.survey.created_by !== context.actorId
  ) {
    throw new ApiError(503, 'Unable to verify survey creation')
  }
  return parsed.data.survey as TableRow<'surveys'>
}
