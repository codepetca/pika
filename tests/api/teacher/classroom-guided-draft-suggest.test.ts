import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-handler'
import { POST } from '@/app/api/teacher/classrooms/[id]/authoring-drafts/suggest/route'
import { verifyClassroomDraftProvenanceToken } from '@/lib/server/classroom-draft-provenance'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getGuidance: vi.fn(),
  generate: vi.fn(),
  acquire: vi.fn(),
  canMutate: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/server/classroom-authoring-guidance', () => ({
  getClassroomAuthoringGuidance: mocks.getGuidance,
}))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherCanMutateClassroom: mocks.canMutate,
}))
vi.mock('@/lib/server/course-blueprint-guided-drafting', () => ({
  generateClassroomGuidedDraft: mocks.generate,
}))
vi.mock('@/lib/server/course-blueprint-draft-admission', () => ({
  acquireCourseBlueprintDraftSlot: mocks.acquire,
}))

const unitId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const source = {
  source_blueprint_version_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  source_blueprint_version_number: 3,
  source_draft_revision: 9,
  guidance: {
    course_expectations_markdown: 'Frozen rule',
    assignment_guidance_markdown: 'Frozen assignment rule',
    test_guidance_markdown: 'Frozen test rule',
    unit_exceptions: [{
      id: unitId, unit_label: 'Unit 1', assignment_guidance_markdown: 'Unit rule',
      test_guidance_markdown: 'Unit test rule',
    }],
  },
  course: {
    title: 'Frozen course', subject: 'Science', grade_level: '11', outline_markdown: 'Frozen outline',
    assignment_titles: [], test_titles: [],
  },
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/teacher/classrooms/classroom-1/authoring-drafts/suggest', {
    method: 'POST', body: JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({ id: 'classroom-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SESSION_SECRET', 'test-session-secret-with-at-least-32-characters')
  mocks.requireRole.mockResolvedValue({ id: 'teacher-1' })
  mocks.getGuidance.mockResolvedValue({ ok: true, context: source })
  mocks.canMutate.mockResolvedValue({ ok: true, classroom: { id: 'classroom-1' } })
  mocks.acquire.mockResolvedValue(vi.fn(async () => {}))
  mocks.generate.mockResolvedValue({
    target: 'assignments', content: '## A draft\n\nPoints: 5', draft: { title: 'A draft' },
    guidance: {
      source_blueprint_version_id: source.source_blueprint_version_id,
      source_blueprint_version_number: 3,
      source_draft_revision: 9,
      target: 'assignments', unit_exception_id: unitId, unit_label: 'Unit 1',
      rules_markdown: 'Frozen rule', trial: false,
    },
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('classroom guided draft suggestion', () => {
  it('uses the owned classroom frozen Version and signs a standalone preview', async () => {
    const response = await POST(request({
      target: 'assignments', prompt: 'Create practice', unit_exception_id: unitId,
    }), context)
    expect(response.status).toBe(200)
    expect(mocks.getGuidance).toHaveBeenCalledWith('teacher-1', 'classroom-1')
    expect(mocks.generate).toHaveBeenCalledWith({
      source, target: 'assignments', prompt: 'Create practice', unitExceptionId: unitId,
    })
    const preview = (await response.json()).suggestion
    expect(preview.draft_id).toMatch(/^[a-f0-9-]{36}$/)
    const { trial, ...provenance } = preview.guidance
    expect(verifyClassroomDraftProvenanceToken({
      token: preview.draft_provenance_token,
      teacherId: 'teacher-1', classroomId: 'classroom-1', draftId: preview.draft_id,
      provenance, seedContentSha256: preview.original_content_sha256,
    })).toBe(true)
  })

  it('rejects unsaved trial guidance at the request boundary', async () => {
    const response = await POST(request({
      target: 'tests', trial_guidance: source.guidance,
    }), context)
    expect(response.status).toBe(400)
    expect(mocks.getGuidance).not.toHaveBeenCalled()
    expect(mocks.acquire).not.toHaveBeenCalled()
  })

  it('rejects a stale unit before reserving a paid provider slot', async () => {
    const response = await POST(request({
      target: 'tests', unit_exception_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    }), context)
    expect(response.status).toBe(409)
    expect(mocks.acquire).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('accepts an equivalent UUID spelling for a frozen unit', async () => {
    const uppercaseSource = {
      ...source,
      guidance: {
        ...source.guidance,
        unit_exceptions: [{ ...source.guidance.unit_exceptions[0], id: unitId.toUpperCase() }],
      },
    }
    mocks.getGuidance.mockResolvedValue({ ok: true, context: uppercaseSource })
    const response = await POST(request({
      target: 'assignments', prompt: 'Create practice', unit_exception_id: unitId,
    }), context)
    expect(response.status).toBe(200)
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      source: uppercaseSource,
      unitExceptionId: unitId,
    }))
  })

  it('rejects classrooms without a frozen Blueprint Version', async () => {
    mocks.getGuidance.mockResolvedValue({ ok: true, context: null })
    const response = await POST(request({ target: 'tests' }), context)
    expect(response.status).toBe(409)
    expect(mocks.acquire).not.toHaveBeenCalled()
  })

  it('rejects an archived classroom before reserving a slot or calling the model', async () => {
    mocks.canMutate.mockResolvedValue({ ok: false, status: 403, error: 'Classroom is archived' })
    const response = await POST(request({ target: 'tests' }), context)
    expect(response.status).toBe(403)
    expect(mocks.getGuidance).not.toHaveBeenCalled()
    expect(mocks.acquire).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('honors paid per-teacher admission and releases after provider failure', async () => {
    mocks.acquire.mockRejectedValueOnce(new ApiError(429, 'Too many AI drafts'))
    const rejected = await POST(request({ target: 'tests' }), context)
    expect(rejected.status).toBe(429)
    expect(mocks.generate).not.toHaveBeenCalled()

    const release = vi.fn(async () => {})
    mocks.acquire.mockResolvedValueOnce(release)
    mocks.generate.mockRejectedValueOnce(new Error('Provider unavailable'))
    const failed = await POST(request({ target: 'tests' }), context)
    expect(failed.status).toBe(500)
    expect(release).toHaveBeenCalledTimes(1)
  })
})
