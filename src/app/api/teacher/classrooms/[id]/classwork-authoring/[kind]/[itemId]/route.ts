import { NextResponse } from 'next/server'
import { z } from 'zod'

import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { authorizeContextualClassworkCreationRequest } from '@/lib/server/contextual-classwork-creation-access'
import {
  classworkDraftResponse,
  classworkItemResponse,
  prepareClassworkContent,
  throwClassworkDraftError,
} from '@/lib/server/classwork-authoring-drafts'
import { materialScheduledForSchema, validateMaterialPublication } from '@/lib/validations/material-scheduling'
import { classworkAuthoringKind } from '@/lib/validations/classwork-authoring-drafts'
import type { Json } from '@/types/database.generated'

export const dynamic = 'force-dynamic'

const uuid = z.string().uuid()
const paramsSchema = z.object({ id: uuid, kind: classworkAuthoringKind, itemId: z.union([uuid, z.literal('new')]) })
const createSchema = z.object({ requestId: uuid, content: z.json() }).strict()
const saveSchema = createSchema.extend({
  expectedRevision: uuid.nullable(),
  saveAsDraft: z.boolean().default(false),
  expectedSourceRevision: z.string().regex(/^[0-9a-f]{64}$/),
})
const sourceRevisionSchema = z.string().regex(/^[0-9a-f]{64}$/)
const applySchema = z.object({
  revision: uuid,
  publish: z.boolean().default(false),
  discard: z.boolean().default(false),
}).strict().refine((input) => !(input.publish && input.discard), 'Choose one draft action.')
const publicationSchema = z.object({
  expectedSourceRevision: sourceRevisionSchema,
  publication: z.object({
    is_draft: z.boolean(),
    scheduled_for: materialScheduledForSchema.optional(),
  }).strict().superRefine(validateMaterialPublication),
}).strict()
const postSchema = z.union([applySchema, publicationSchema])

async function getContext(rawParams: unknown) {
  const { id, kind, itemId } = paramsSchema.parse(rawParams)
  const access = await authorizeContextualClassworkCreationRequest(id)
  return {
    db: getServiceRoleClient(),
    kind,
    itemId,
    args: { p_actor_id: access.user.id, p_classroom_id: access.classroomId, p_kind: kind },
  }
}

async function readPayload(request: Request) {
  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > 2_000_000) throw new ApiError(413, 'Classwork draft is too large.')
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new ApiError(400, 'Invalid Classwork draft request.')
  }
}

export const GET = withErrorHandler('ReadClassworkAuthoringDraft', async (_request, context) => {
  const { db, args, itemId } = await getContext(await context.params)
  if (itemId === 'new') throw new ApiError(404, 'Classwork item not found.')
  const { data, error } = await db.rpc('read_classwork_authoring_draft', { ...args, p_item_id: itemId })
  if (error) throwClassworkDraftError(error)
  return NextResponse.json(classworkItemResponse.extend(classworkDraftResponse.shape).parse(data), { headers: { 'Cache-Control': 'no-store' } })
})

export const PUT = withErrorHandler('SaveClassworkAuthoringDraft', async (request, context) => {
  const { db, args, kind, itemId } = await getContext(await context.params)
  if (itemId === 'new') throw new ApiError(404, 'Classwork item not found.')
  const input = saveSchema.parse(await readPayload(request))
  if (input.saveAsDraft && kind === 'survey') throw new ApiError(400, 'Survey drafts use a private snapshot.')
  const { draft, projection } = prepareClassworkContent(kind, input.content, input.saveAsDraft ? 'draft' : 'save')
  const { data, error } = await db.rpc('save_classwork_authoring_draft', {
    ...args,
    p_item_id: itemId,
    p_expected_revision: input.expectedRevision ?? undefined,
    p_expected_source_revision: input.expectedSourceRevision,
    p_request_id: input.requestId,
    p_content: draft,
    p_save_as_draft: input.saveAsDraft,
    p_projection: input.saveAsDraft || kind === 'survey' ? projection : undefined,
  })
  if (error) throwClassworkDraftError(error)
  return NextResponse.json(input.saveAsDraft || kind === 'survey' ? classworkItemResponse.extend(classworkDraftResponse.shape).parse(data) : classworkDraftResponse.parse(data))
})

export const POST = withErrorHandler('SubmitClassworkAuthoringDraft', async (request, context) => {
  const { db, args, kind, itemId } = await getContext(await context.params)
  const payload = await readPayload(request)
  if (itemId === 'new') {
    const input = createSchema.parse(payload)
    const { draft, projection } = prepareClassworkContent(kind, input.content, 'create')
    const { data, error } = await db.rpc('create_classwork_authoring_draft', {
      ...args,
      p_request_id: input.requestId,
      p_content: draft,
      p_projection: projection,
    })
    if (error) throwClassworkDraftError(error)
    return NextResponse.json(classworkItemResponse.extend(classworkDraftResponse.shape).parse(data), { status: 201 })
  }

  const input = postSchema.parse(payload)
  if ('publication' in input) {
    if (kind !== 'material') throw new ApiError(400, 'Invalid Classwork publication request.')
    const { data, error } = await db.rpc('publish_classwork_authoring_material', {
      p_actor_id: args.p_actor_id,
      p_classroom_id: args.p_classroom_id,
      p_item_id: itemId,
      p_expected_source_revision: input.expectedSourceRevision,
      p_publication: input.publication,
    })
    if (error) throwClassworkDraftError(error)
    return NextResponse.json(classworkItemResponse.parse(data))
  }
  if (input.publish && kind !== 'survey') throw new ApiError(400, 'Use the post action to release this Classwork item.')
  const itemArgs = { ...args, p_item_id: itemId }
  const { data: saved, error: readError } = await db.rpc('read_classwork_authoring_draft', itemArgs)
  if (readError) throwClassworkDraftError(readError)
  const { draft } = classworkDraftResponse.parse(saved)
  if (draft && draft.revision !== input.revision) {
    throw new ApiError(409, 'This draft changed in another editor. Reopen it before applying.')
  }
  const projection = draft && !input.discard ? prepareClassworkContent(kind, draft.content, 'apply').projection : {}
  const { data, error } = await db.rpc('apply_classwork_authoring_draft', {
    ...itemArgs,
    p_revision: input.revision,
    p_publish: input.publish,
    p_discard: input.discard,
    p_projection: { source: draft?.content as Json ?? null, values: projection },
  })
  if (error) throwClassworkDraftError(error)
  return NextResponse.json(classworkItemResponse.parse(data))
})
