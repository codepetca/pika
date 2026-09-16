import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildAssignmentGradingRequest,
  generateAssignmentAnchors,
  gradeStudentWork,
  hasThinAnchorInstructions,
  resolveAssignmentGradingAnchors,
} from '@/lib/ai-grading'
import { normalizePikaAssignmentAnchors } from '@/lib/grading/profiles/pika-assignment-anchors'

const anchors = normalizePikaAssignmentAnchors({
  anchors: ['completion', 'thinking', 'workflow'].map((criterionId) => ({
    criterion_id: criterionId,
    band_9_10: `${criterionId} top band marker`,
    band_7_8: `${criterionId} upper band marker`,
    band_4_6: `${criterionId} middle band marker`,
    band_0_3: `${criterionId} bottom band marker`,
  })),
  notes: null,
})

const studentWork = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My submission.' }] }],
}

function jsonReply(payload: unknown) {
  return { ok: true, json: async () => payload }
}

function gradeReply(content: string) {
  return jsonReply({ choices: [{ message: { content }, finish_reason: 'stop' }] })
}

describe('assignment grading anchors', () => {
  beforeEach(() => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('ignores anchors while the flag is off', () => {
    vi.stubEnv('ASSIGNMENT_GRADING_ANCHORS_ENABLED', 'false')
    expect(resolveAssignmentGradingAnchors(anchors)).toBeNull()

    const request = buildAssignmentGradingRequest({
      assignmentTitle: 'Reflection', instructions: 'Reflect.', studentWork, anchors,
    })
    expect(request.anchors).toBeNull()
    expect(request.systemPrompt).not.toContain('top band marker')
  })

  it('drops anchors that carry no criteria even while the flag is on', () => {
    vi.stubEnv('ASSIGNMENT_GRADING_ANCHORS_ENABLED', 'true')
    expect(resolveAssignmentGradingAnchors({ ...anchors, criteria: [] })).toBeNull()
    expect(resolveAssignmentGradingAnchors(null)).toBeNull()
  })

  it('puts every band in the grading prompt while the flag is on', () => {
    vi.stubEnv('ASSIGNMENT_GRADING_ANCHORS_ENABLED', 'true')
    const request = buildAssignmentGradingRequest({
      assignmentTitle: 'Reflection', instructions: 'Reflect.', studentWork, anchors,
    })

    expect(request.anchors).not.toBeNull()
    expect(request.systemPrompt).toContain('completion top band marker')
    expect(request.systemPrompt).toContain('workflow bottom band marker')
    expect(request.systemPrompt).toContain('Do not default to the top band')
    // The student-facing contract must not drift between the two profiles.
    expect(request.systemPrompt).toContain('sentence starting with "Strength:"')
    expect(request.userPrompt).toContain('My submission.')
  })

  it('records the anchored prompt and profile versions in provenance', async () => {
    vi.stubEnv('ASSIGNMENT_GRADING_ANCHORS_ENABLED', 'true')
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(gradeReply(
      '{"score_completion":6,"score_thinking":5,"score_workflow":6,"feedback":"Strength: Clear start. Next Step: Add evidence. Improve: Develop the middle section."}',
    ))

    const result = await gradeStudentWork({
      assignmentTitle: 'Reflection', instructions: 'Reflect.', studentWork, anchors,
    })

    expect(result.score_completion).toBe(6)
    expect(result.prompt_version).toBe('pika-assignment-anchored-prompt-v1')
    expect(result.grading_profile_version).toBe('pika-assignment-anchored-v1')
    // Rubric meaning is unchanged, so its version must not move.
    expect(result.rubric_version).toBe('pika-essay-ctw-v1')
    expect(result.provenance.promptVersion).toBe('pika-assignment-anchored-prompt-v1')
  })

  it('keeps the unanchored versions when no anchors are supplied', async () => {
    vi.stubEnv('ASSIGNMENT_GRADING_ANCHORS_ENABLED', 'true')
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(gradeReply(
      '{"score_completion":8,"score_thinking":8,"score_workflow":8,"feedback":"Strength: Solid. Next Step: Add detail. Improve: Add an example."}',
    ))

    const result = await gradeStudentWork({
      assignmentTitle: 'Reflection', instructions: 'Reflect.', studentWork,
    })
    expect(result.prompt_version).toBe('pika-assignment-prompt-v1')
    expect(result.grading_profile_version).toBe('pika-assignment-v1')
  })

  it('generates anchors in one call and flags thin instructions', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonReply({
      choices: [{
        message: { content: JSON.stringify({
          anchors: ['completion', 'thinking', 'workflow'].map((criterionId) => ({
            criterion_id: criterionId,
            band_9_10: 'top', band_7_8: 'upper', band_4_6: 'middle', band_0_3: 'bottom',
          })),
          notes: 'Assumed a written reflection.',
        }) },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 300, completion_tokens: 200, total_tokens: 500 },
    }))

    const result = await generateAssignmentAnchors({
      assignmentTitle: 'Reflection', instructions: 'Reflect.',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.anchors.criteria).toHaveLength(3)
    expect(result.anchors.notes).toBe('Assumed a written reflection.')
    expect(result.thinInstructions).toBe(true)
    expect(result.tokenUsage).toEqual({ input_tokens: 300, output_tokens: 200, total_tokens: 500 })

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.messages[0].content).toContain('assignment_score_anchors')
  })

  it('keeps anchor generation failures content-free', async () => {
    const privateMarker = 'PRIVATE alex@example.invalid student-work'
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(gradeReply(JSON.stringify({
      anchors: [{
        criterion_id: 'completion',
        band_9_10: privateMarker, band_7_8: 'a', band_4_6: 'b', band_0_3: 'c',
      }],
      notes: null,
    })))

    const error = await generateAssignmentAnchors({
      assignmentTitle: 'Reflection', instructions: 'Reflect.',
    }).catch((error: unknown) => error)

    expect(error).toMatchObject({ kind: 'invalid_output', retryable: false })
    expect(String((error as Error).message)).not.toContain(privateMarker)
  })

  it('treats a substantial instruction block as sufficient', () => {
    expect(hasThinAnchorInstructions('Reflect.')).toBe(true)
    expect(hasThinAnchorInstructions('x'.repeat(200))).toBe(false)
  })
})
