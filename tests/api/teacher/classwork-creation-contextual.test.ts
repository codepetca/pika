import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { POST as materialPOST } from '@/app/api/teacher/classrooms/[id]/materials/route'
import { POST as surveyPOST } from '@/app/api/teacher/surveys/route'
import { authorizeContextualClassworkCreationRequest } from '@/lib/server/contextual-classwork-creation-access'
import {
  createClassworkMaterialForOwner,
  createSurveyForOwner,
} from '@/lib/server/contextual-classwork-creation'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const user = { id: actorId, role: 'student', email: 'owner@example.com' }
const mockSupabase = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabase) }))
vi.mock('@/lib/server/contextual-classwork-creation-access', () => ({
  authorizeContextualClassworkCreationRequest: vi.fn(),
}))
vi.mock('@/lib/server/contextual-classwork-creation', () => ({
  createClassworkMaterialForOwner: vi.fn(),
  createSurveyForOwner: vi.fn(),
}))

describe('contextual mixed-classwork creation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authorizeContextualClassworkCreationRequest).mockResolvedValue({
      mode: 'contextual', user: user as any, classroomId,
    })
  })

  it('routes a student-valued owner material through the shared fence', async () => {
    const material = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      classroom_id: classroomId,
      created_by: actorId,
      title: 'Reference',
      position: 1,
    }
    vi.mocked(createClassworkMaterialForOwner).mockResolvedValue(material as never)
    const response = await materialPOST(new NextRequest(
      `http://localhost/api/teacher/classrooms/${classroomId}/materials`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: ' Reference ',
          content: { type: 'doc', content: [] },
          is_draft: false,
        }),
      },
    ), { params: Promise.resolve({ id: classroomId }) })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ material })
    expect(createClassworkMaterialForOwner).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      classroomId,
      title: 'Reference',
      isDraft: false,
    }))
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('routes a student-valued owner survey through the shared fence', async () => {
    const survey = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      classroom_id: classroomId,
      created_by: actorId,
      title: 'Check-in',
      position: 2,
    }
    vi.mocked(createSurveyForOwner).mockResolvedValue(survey as never)
    const response = await surveyPOST(new NextRequest(
      'http://localhost/api/teacher/surveys',
      {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: classroomId,
          title: ' Check-in ',
          show_results: false,
          dynamic_responses: true,
        }),
      },
    ))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ survey })
    expect(createSurveyForOwner).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      classroomId,
      title: 'Check-in',
      showResults: false,
      dynamicResponses: true,
    }))
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects unknown contextual material keys before the RPC', async () => {
    const response = await materialPOST(new NextRequest(
      `http://localhost/api/teacher/classrooms/${classroomId}/materials`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: 'Reference',
          content: { type: 'doc' },
          created_by: actorId,
        }),
      },
    ), { params: Promise.resolve({ id: classroomId }) })
    expect(response.status).toBe(400)
    expect(createClassworkMaterialForOwner).not.toHaveBeenCalled()
  })
})
