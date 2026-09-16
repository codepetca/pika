import { describe, expect, it } from 'vitest'
import {
  buildPikaAssignmentAnchorPrompt,
  formatAssignmentAnchorsForPrompt,
  normalizePikaAssignmentAnchors,
  parsePikaAssignmentAnchorOutput,
  PIKA_ASSIGNMENT_ANCHOR_BANDS,
  PIKA_ASSIGNMENT_ANCHOR_PROFILE_VERSION,
  type PikaAssignmentAnchorOutput,
} from '@/lib/grading/profiles/pika-assignment-anchors'
import { PIKA_ASSIGNMENT_RUBRIC_VERSION } from '@/lib/grading/profiles/pika-assignment'

function anchorFor(criterionId: string) {
  return {
    criterion_id: criterionId,
    band_9_10: `${criterionId} at the top band`,
    band_7_8: `${criterionId} at the upper-middle band`,
    band_4_6: `${criterionId} at the middle band`,
    band_0_3: `${criterionId} at the bottom band`,
  }
}

const completeOutput: PikaAssignmentAnchorOutput = {
  anchors: [anchorFor('completion'), anchorFor('thinking'), anchorFor('workflow')],
  notes: null,
}

describe('assignment anchor prompt', () => {
  it('lists every rubric criterion and forbids a single correct answer', () => {
    const { systemPrompt, userPrompt } = buildPikaAssignmentAnchorPrompt({
      assignmentTitle: 'Reflection',
      instructions: 'Write a reflection about your learning process.',
    })

    expect(systemPrompt).toContain('completion (Completion)')
    expect(systemPrompt).toContain('thinking (Thinking)')
    expect(systemPrompt).toContain('workflow (Workflow)')
    expect(systemPrompt).toContain('9-10, 7-8, 4-6, 0-3')
    expect(systemPrompt).toContain('not a single correct answer')
    expect(userPrompt).toContain('Reflection')
    expect(userPrompt).toContain('Write a reflection about your learning process.')
  })
})

describe('assignment anchor parsing and normalization', () => {
  it('parses output wrapped in a markdown code fence', () => {
    const parsed = parsePikaAssignmentAnchorOutput(
      '```json\n' + JSON.stringify(completeOutput) + '\n```',
    )
    expect(parsed.anchors).toHaveLength(3)
  })

  it('builds four fixed bands per rubric criterion', () => {
    const anchors = normalizePikaAssignmentAnchors(completeOutput)

    expect(anchors.schemaVersion).toBe('assignment-grading-anchors-v1')
    expect(anchors.rubricVersion).toBe(PIKA_ASSIGNMENT_RUBRIC_VERSION)
    expect(anchors.anchorProfileVersion).toBe(PIKA_ASSIGNMENT_ANCHOR_PROFILE_VERSION)
    expect(anchors.criteria.map((criterion) => criterion.criterionId))
      .toEqual(['completion', 'thinking', 'workflow'])

    for (const criterion of anchors.criteria) {
      expect(criterion.bands.map((band) => [band.minScore, band.maxScore]))
        .toEqual(PIKA_ASSIGNMENT_ANCHOR_BANDS.map((band) => [band.min, band.max]))
    }
  })

  it('ignores criteria the rubric does not define', () => {
    const anchors = normalizePikaAssignmentAnchors({
      anchors: [...completeOutput.anchors, anchorFor('invented_criterion')],
      notes: null,
    })
    expect(anchors.criteria).toHaveLength(3)
  })

  it.each(['completion', 'thinking', 'workflow'])('rejects output missing %s', (criterionId) => {
    expect(() => normalizePikaAssignmentAnchors({
      anchors: completeOutput.anchors.filter((anchor) => anchor.criterion_id !== criterionId),
      notes: null,
    })).toThrow(`Missing score anchor for criterion: ${criterionId}`)
  })

  it('rejects a whitespace-only descriptor', () => {
    const blanked = completeOutput.anchors.map((anchor) =>
      anchor.criterion_id === 'thinking' ? { ...anchor, band_4_6: '   ' } : anchor)
    expect(() => normalizePikaAssignmentAnchors({ anchors: blanked, notes: null }))
      .toThrow('Empty score anchor descriptor for criterion: thinking')
  })

  it('keeps notes when present and normalizes blank notes to null', () => {
    expect(normalizePikaAssignmentAnchors({ ...completeOutput, notes: '  Assumed a written response.  ' }).notes)
      .toBe('Assumed a written response.')
    expect(normalizePikaAssignmentAnchors({ ...completeOutput, notes: '   ' }).notes).toBeNull()
  })

  it('renders every band into the grading prompt block', () => {
    const block = formatAssignmentAnchorsForPrompt(normalizePikaAssignmentAnchors(completeOutput))
    expect(block).toContain('Completion (completion):')
    expect(block).toContain('  - 9-10: completion at the top band')
    expect(block).toContain('  - 0-3: workflow at the bottom band')
  })
})
