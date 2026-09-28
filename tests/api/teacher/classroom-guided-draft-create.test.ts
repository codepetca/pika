import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/classrooms/[id]/authoring-drafts/create/route'
import { courseBlueprintAssignmentsToMarkdown } from '@/lib/course-blueprint-assignments'
import { courseBlueprintAssessmentsToMarkdown } from '@/lib/course-blueprint-assessments-markdown'
import { resolveCourseBlueprintAuthoringContext } from '@/lib/course-blueprint-authoring-context'
import {
  createClassroomDraftProvenanceToken,
  hashClassroomDraftContent,
} from '@/lib/server/classroom-draft-provenance'

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), getGuidance: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/server/classroom-authoring-guidance', () => ({
  getClassroomAuthoringGuidance: mocks.getGuidance,
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc: mocks.rpc }) }))

const versionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const unitId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const draftId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const source = {
  source_blueprint_version_id: versionId,
  source_blueprint_version_number: 3,
  source_draft_revision: 9,
  guidance: {
    course_expectations_markdown: 'Frozen course rule',
    assignment_guidance_markdown: 'Frozen assignment rule',
    test_guidance_markdown: 'Frozen test rule',
    unit_exceptions: [{
      id: unitId, unit_label: 'Unit 1',
      assignment_guidance_markdown: 'Frozen unit assignment rule',
      test_guidance_markdown: 'Frozen unit test rule',
    }],
  },
  course: {
    title: 'Frozen title', subject: '', grade_level: '', outline_markdown: '',
    assignment_titles: [], test_titles: [],
  },
}

function assignmentMarkdown(instructions = 'Explain your program.') {
  return courseBlueprintAssignmentsToMarkdown([{
    title: 'Program assignment', instructions_markdown: instructions,
    default_due_days: 7, default_due_time: '23:59', points_possible: 20,
    include_in_final: true, is_draft: true, position: 0,
  }])
}

function testMarkdown() {
  return courseBlueprintAssessmentsToMarkdown([{
    assessment_type: 'test', title: 'Unit test', position: 0,
    content: {
      title: 'Unit test', show_results: false,
      questions: [{
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        question_type: 'open_response', question_text: 'Explain the result.',
        options: [], correct_option: null, answer_key: 'A reasoned explanation.',
        sample_solution: 'The output follows the loop.', points: 5,
        response_max_chars: 5000, response_monospace: false,
      }],
    },
    documents: [{
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      title: 'Instructions', source: 'text', content: '# Instructions\n\nRead carefully.',
    }],
  }], 'test')
}

function body(target: 'assignments' | 'tests', content: string, options: { trial?: boolean } = {}) {
  const provenance = {
    source_blueprint_version_id: versionId,
    source_blueprint_version_number: 3,
    source_draft_revision: 9,
    ...resolveCourseBlueprintAuthoringContext({
      guidance: source.guidance, target, unitExceptionId: unitId,
    }),
  }
  const originalContentSha256 = hashClassroomDraftContent(content)
  return {
    target, content, draft_id: draftId,
    draft_provenance_token: createClassroomDraftProvenanceToken({
      teacherId: 'teacher-1', classroomId: 'classroom-1', draftId,
      provenance, seedContentSha256: originalContentSha256, trial: options.trial,
    }),
    original_content_sha256: originalContentSha256,
    unit_exception_id: unitId,
  }
}

function request(value: unknown) {
  return new NextRequest('http://localhost/api/teacher/classrooms/classroom-1/authoring-drafts/create', {
    method: 'POST', body: JSON.stringify(value),
  })
}
const context = { params: Promise.resolve({ id: 'classroom-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SESSION_SECRET', 'test-session-secret-with-at-least-32-characters')
  mocks.requireRole.mockResolvedValue({ id: 'teacher-1' })
  mocks.getGuidance.mockResolvedValue({ ok: true, context: source })
  mocks.rpc.mockResolvedValue({ data: { ok: true, assignment: { id: 'assignment-1' }, submission_requirements: [] }, error: null })
})
afterEach(() => vi.unstubAllEnvs())

describe('classroom guided draft creation', () => {
  it('accepts teacher edits and creates exactly one draft assignment with frozen Version provenance', async () => {
    const preview = body('assignments', assignmentMarkdown())
    const response = await POST(request({ ...preview, content: assignmentMarkdown('Edited instructions.') }), context)
    expect(response.status).toBe(201)
    expect((await response.json()).assignment).toEqual({ id: 'assignment-1', submission_requirements: [] })
    expect(mocks.rpc).toHaveBeenCalledWith('create_guided_assignment_for_owner_v1', expect.objectContaining({
      p_actor_id: 'teacher-1', p_classroom_id: 'classroom-1',
      p_expected_blueprint_version_id: versionId, p_unit_exception_id: unitId,
      p_draft_id: draftId,
      p_instructions_markdown: 'Edited instructions.',
      p_points_possible: 20,
      p_seed_sha256: preview.original_content_sha256,
      p_rules_markdown: expect.stringContaining('Frozen unit assignment rule'),
    }))
  })

  it('creates a Test with questions and reference documents from the edited Markdown', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, test: { id: 'test-1' } }, error: null })
    const response = await POST(request(body('tests', testMarkdown())), context)
    expect(response.status).toBe(201)
    expect((await response.json()).test).toEqual({ id: 'test-1' })
    expect(mocks.rpc).toHaveBeenCalledWith('create_guided_test_for_owner_v1', expect.objectContaining({
      p_draft_content: expect.objectContaining({ question_identity_version: 1, questions: [expect.objectContaining({
        question_text: 'Explain the result.',
      })] }),
      p_documents: [expect.objectContaining({ title: 'Instructions', source: 'text' })],
    }))
  })

  it('rejects trial and tampered unit tokens before writing', async () => {
    const trial = await POST(request(body('assignments', assignmentMarkdown(), { trial: true })), context)
    expect(trial.status).toBe(409)
    const otherUnit = await POST(request({
      ...body('assignments', assignmentMarkdown()), unit_exception_id: null,
    }), context)
    expect(otherUnit.status).toBe(409)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects malformed and zero-point edited previews before writing', async () => {
    const valid = body('assignments', assignmentMarkdown())
    const malformed = await POST(request({ ...valid, content: 'Not a standalone assignment' }), context)
    expect(malformed.status).toBe(400)
    const zero = await POST(request({
      ...valid, content: assignmentMarkdown().replace('Points: 20', 'Points: 0'),
    }), context)
    expect(zero.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('maps a replayed draft id to a conflict without another artifact', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505' } })
    const response = await POST(request(body('assignments', assignmentMarkdown())), context)
    expect(response.status).toBe(409)
  })

  it('does not write for a different classroom owner', async () => {
    mocks.getGuidance.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const response = await POST(request(body('assignments', assignmentMarkdown())), context)
    expect(response.status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
