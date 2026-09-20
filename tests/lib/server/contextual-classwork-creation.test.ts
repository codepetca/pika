import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api-error'
import {
  createClassworkMaterialForOwner,
  createSurveyForOwner,
} from '@/lib/server/contextual-classwork-creation'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('contextual classwork creation adapters', () => {
  it('returns a bound material from the actor-bound RPC', async () => {
    const material = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      classroom_id: classroomId,
      created_by: actorId,
      position: 3,
      title: 'Reference',
    }
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, material }, error: null })

    await expect(createClassworkMaterialForOwner({
      supabase: { rpc },
      actorId,
      classroomId,
      title: 'Reference',
      content: { type: 'doc', content: [] },
      isDraft: false,
    })).resolves.toMatchObject(material)
    expect(rpc).toHaveBeenCalledWith('create_classwork_material_for_owner_v1', {
      p_actor_id: actorId,
      p_classroom_id: classroomId,
      p_title: 'Reference',
      p_content: { type: 'doc', content: [] },
      p_is_draft: false,
    })
  })

  it('returns a bound survey from the actor-bound RPC', async () => {
    const survey = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      classroom_id: classroomId,
      created_by: actorId,
      position: 4,
      title: 'Check-in',
    }
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, survey }, error: null })

    await expect(createSurveyForOwner({
      supabase: { rpc },
      actorId,
      classroomId,
      title: 'Check-in',
      showResults: true,
      dynamicResponses: false,
    })).resolves.toMatchObject(survey)
    expect(rpc).toHaveBeenCalledWith('create_survey_for_owner_v1', {
      p_actor_id: actorId,
      p_classroom_id: classroomId,
      p_title: 'Check-in',
      p_show_results: true,
      p_dynamic_responses: false,
    })
  })

  it.each([
    ['material', createClassworkMaterialForOwner, 'material'],
    ['survey', createSurveyForOwner, 'survey'],
  ] as const)('rejects substituted %s evidence', async (_label, create, responseKey) => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        [responseKey]: {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          classroom_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          created_by: actorId,
          position: 0,
        },
      },
      error: null,
    })
    const base = { supabase: { rpc }, actorId, classroomId, title: 'Title' }
    const promise = responseKey === 'material'
      ? create({ ...base, content: { type: 'doc' }, isDraft: true } as never)
      : create({ ...base, showResults: true, dynamicResponses: false } as never)
    await expect(promise).rejects.toBeInstanceOf(ApiError)
  })

  it('maps ownership denial without exposing database details', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'secret' } })
    await expect(createSurveyForOwner({
      supabase: { rpc }, actorId, classroomId, title: 'Title',
      showResults: true, dynamicResponses: false,
    })).rejects.toMatchObject({ statusCode: 403, message: 'Unauthorized' })
  })
})
