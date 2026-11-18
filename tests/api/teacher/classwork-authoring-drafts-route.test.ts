import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST, PUT } from '@/app/api/teacher/classrooms/[id]/classwork-authoring/[kind]/[itemId]/route'
import { ApiError } from '@/lib/api-error'

const { rpc, authorize } = vi.hoisted(() => ({ rpc: vi.fn(), authorize: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc }) }))
vi.mock('@/lib/server/contextual-classwork-creation-access', () => ({
  authorizeContextualClassworkCreationRequest: authorize,
}))

const classroom = '30200000-0000-4000-8000-000000000001'
const itemId = '30200000-0000-4000-8000-000000000002'
const actor = '30200000-0000-4000-8000-000000000003'
const revision = '30200000-0000-4000-8000-000000000004'
const sourceRevision = 'a'.repeat(64)
const item = { id: itemId, classroom_id: classroom, title: 'Published' }
const content = { title: 'Private edit', content: { type: 'doc', content: [] }, posted_on: '2026-11-08' }
const context = { params: Promise.resolve({ id: classroom, itemId, kind: 'material' }) }

function request(method: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/teacher/classrooms/${classroom}/classwork-authoring/material/${itemId}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('teacher Classwork authoring draft route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    authorize.mockResolvedValue({ user: { id: actor }, classroomId: classroom })
  })

  it('authorizes before reading any private snapshot', async () => {
    authorize.mockRejectedValue(new ApiError(403, 'Forbidden'))
    expect((await GET(request('GET'), context)).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(['read', 'create', 'save', 'apply', 'discard'] as const)(
    'retains the current assignment release intent after %s',
    async (operation) => {
      const updatedAt = '2026-11-18T12:00:00.123456Z'
      const assignment = { ...item, is_draft: true, released_at: null, updated_at: updatedAt }
      const releaseSchedule = { id: revision, state: 'pending', scheduled_for: '2026-11-20T12:00:00Z', notice_code: null }
      const assignmentContent = { title: 'Edited', instructions_markdown: '', due_at: '2026-11-21T23:59:59Z', submission_requirements: [] }
      const response = { item: assignment, sourceRevision, draft: null }
      rpc.mockImplementation((name: string) => {
        if (name === 'get_assignment_release_states_for_owner_v1') {
          return { abortSignal: () => Promise.resolve({ data: [{ assignment_id: itemId, updated_at: updatedAt, release_schedule: releaseSchedule }], error: null }) }
        }
        return Promise.resolve({ data: name === 'read_classwork_authoring_draft' && operation === 'apply'
          ? { ...response, draft: { revision, content: assignmentContent } } : response, error: null })
      })
      const params = { params: Promise.resolve({ id: classroom, itemId: operation === 'create' ? 'new' : itemId, kind: 'assignment' }) }
      const result = operation === 'read'
        ? await GET(request('GET'), params)
        : operation === 'save'
          ? await PUT(request('PUT', { requestId: revision, expectedRevision: null, expectedSourceRevision: sourceRevision, saveAsDraft: true, content: assignmentContent }), params)
          : await POST(request('POST', operation === 'create'
            ? { requestId: revision, content: assignmentContent }
            : { revision, ...(operation === 'discard' ? { discard: true } : {}) }), params)
      expect(result.ok).toBe(true)
      expect((await result.json()).item.release_schedule).toEqual(releaseSchedule)
      expect(rpc).toHaveBeenLastCalledWith('get_assignment_release_states_for_owner_v1', {
        p_actor_id: actor, p_classroom_id: classroom, p_assignment_ids: [itemId],
      })
    },
  )

  it('passes both revisions to the private save and excludes publication fields', async () => {
    rpc.mockResolvedValue({ data: { draft: { revision, content } }, error: null })
    const result = await PUT(request('PUT', { expectedRevision: null, expectedSourceRevision: sourceRevision, requestId: revision, content }), context)
    expect(result.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith('save_classwork_authoring_draft', expect.objectContaining({
      p_actor_id: actor, p_item_id: itemId, p_classroom_id: classroom, p_expected_source_revision: sourceRevision,
      p_content: content,
    }))
    rpc.mockClear()
    const invalid = await PUT(request('PUT', { expectedRevision: null, expectedSourceRevision: sourceRevision, requestId: revision, content: { ...content, is_draft: false } }), context)
    expect(invalid.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('posts a material through the source revision check without accepting editor fields', async () => {
    rpc.mockResolvedValueOnce({ data: { item, sourceRevision }, error: null })
    const publication = { is_draft: false }
    const result = await POST(request('POST', { expectedSourceRevision: sourceRevision, publication }), context)
    expect(result.ok).toBe(true)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('publish_classwork_authoring_material', {
      p_actor_id: actor,
      p_classroom_id: classroom,
      p_item_id: itemId,
      p_expected_source_revision: sourceRevision,
      p_publication: publication,
    })
    rpc.mockClear()
    const invalid = await POST(request('POST', {
      expectedSourceRevision: sourceRevision, publication: { ...publication, content },
    }), context)
    expect(invalid.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('can discard a stale revision without interpreting its old editor fields', async () => {
    rpc.mockResolvedValueOnce({ data: { item, sourceRevision, draft: { revision, content: {}, stale: true } }, error: null })
    rpc.mockResolvedValueOnce({ data: { item, sourceRevision }, error: null })
    const result = await POST(request('POST', { revision, discard: true }), context)
    expect(result.ok).toBe(true)
    expect(rpc).toHaveBeenLastCalledWith('apply_classwork_authoring_draft', expect.objectContaining({
      p_revision: revision,
      p_discard: true,
      p_projection: { source: {}, values: {} },
    }))
  })

  it('uses the stored snapshot for Apply and rejects an outdated revision', async () => {
    rpc.mockResolvedValueOnce({ data: { item, sourceRevision, draft: { revision: actor, content } }, error: null })
    expect((await POST(request('POST', { revision }), context)).status).toBe(409)
    expect(rpc).toHaveBeenCalledTimes(1)

    rpc.mockResolvedValueOnce({ data: { item, sourceRevision, draft: { revision, content } }, error: null })
    rpc.mockResolvedValueOnce({ data: { item: { ...item, title: content.title }, sourceRevision }, error: null })
    const result = await POST(request('POST', { revision }), context)
    expect(result.ok).toBe(true)
    expect(rpc).toHaveBeenLastCalledWith('apply_classwork_authoring_draft', expect.objectContaining({
      p_revision: revision, p_publish: false, p_projection: { source: content, values: content },
    }))
  })
})
