import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as suggest } from '@/app/api/teacher/course-blueprints/[id]/ai/suggest/route'
import { POST as apply } from '@/app/api/teacher/course-blueprints/[id]/ai/apply/route'

const mockGetDetail = vi.fn()
const mockGenerate = vi.fn()
const mockAcquire = vi.fn()
const mockBuildCandidate = vi.fn()
const mockSubmit = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/course-blueprints', () => ({
  getCourseBlueprintDetail: (...args: unknown[]) => mockGetDetail(...args),
}))
vi.mock('@/lib/server/course-blueprint-guided-drafting', () => ({
  generateCourseBlueprintGuidedDraft: (...args: unknown[]) => mockGenerate(...args),
}))
vi.mock('@/lib/server/course-blueprint-draft-admission', () => ({
  acquireCourseBlueprintDraftSlot: (...args: unknown[]) => mockAcquire(...args),
}))
vi.mock('@/lib/server/course-blueprint-proposals', () => ({
  buildCourseBlueprintAiCandidate: (...args: unknown[]) => mockBuildCandidate(...args),
  submitCourseBlueprintProposal: (...args: unknown[]) => mockSubmit(...args),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => ({})) }))

const routeContext = { params: Promise.resolve({ id: 'blueprint-1' }) } as any
const detail = {
  id: 'blueprint-1',
  authority_mode: 'pika',
  content_revision: 7,
  authoring_guidance: {
    course_expectations_markdown: 'Saved rule A',
    assignment_guidance_markdown: '',
    test_guidance_markdown: '',
    unit_exceptions: [],
  },
}

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost/api/teacher/course-blueprints/blueprint-1/ai/${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SESSION_SECRET', 'test-session-secret-with-at-least-32-characters')
  mockGetDetail.mockResolvedValue({ detail })
  mockAcquire.mockResolvedValue(vi.fn(async () => {}))
  mockBuildCandidate.mockReturnValue({ ok: true, base: {}, candidate: {}, warnings: [] })
  mockSubmit.mockResolvedValue({ ok: true, proposal: { id: 'proposal-1' } })
})
afterEach(() => vi.unstubAllEnvs())

describe('guided Blueprint draft routes', () => {
  it('rejects direct submission of a trial even when its Blueprint revision is unchanged', async () => {
    mockGenerate.mockResolvedValue({
      target: 'tests', content: 'Generated test',
      guidance: {
        blueprint_revision: 7, target: 'tests', unit_exception_id: null,
        unit_label: null, rules_markdown: '## Course expectations\n\nUnsaved rule B', trial: true,
      },
    })
    const suggested = await suggest(post('suggest', {
      target: 'tests', trial_guidance: {
        ...detail.authoring_guidance, course_expectations_markdown: 'Unsaved rule B',
      },
    }), routeContext)
    expect(suggested.status).toBe(200)
    const preview = (await suggested.json()).suggestion
    const submitted = await apply(post('apply', {
      target: 'tests', content: preview.content,
      original_content: preview.content,
      draft_provenance_token: preview.draft_provenance_token,
      expected_blueprint_revision: 7,
    }), routeContext)
    expect(submitted.status).toBe(409)
    expect(mockBuildCandidate).not.toHaveBeenCalled()
    expect(mockSubmit).not.toHaveBeenCalled()
  })

  it('proposes a saved-guidance preview with its exact saved rules', async () => {
    mockGenerate.mockResolvedValue({
      target: 'assignments', content: 'Generated assignment',
      guidance: {
        blueprint_revision: 7, target: 'assignments', unit_exception_id: null,
        unit_label: null, rules_markdown: '## Course expectations\n\nSaved rule A', trial: false,
      },
    })
    const suggested = await suggest(post('suggest', { target: 'assignments' }), routeContext)
    const preview = (await suggested.json()).suggestion
    const submitted = await apply(post('apply', {
      target: 'assignments', content: 'Teacher-edited assignment',
      original_content: preview.content,
      draft_provenance_token: preview.draft_provenance_token,
      expected_blueprint_revision: 7,
    }), routeContext)
    expect(submitted.status).toBe(201)
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({
      guidanceProvenance: expect.objectContaining({
        blueprint_revision: 7,
        rules_markdown: '## Course expectations\n\nSaved rule A',
      }),
    }))
  })
})
