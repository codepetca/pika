import { describe, expect, it } from 'vitest'
import { parseCourseBlueprintCopilotResponse, type BlueprintCopilotTarget } from '@/lib/validations/course-blueprint-copilot-response'

const analysis = { missing: [], suggestions: [], counts: { assignments: 0, tests: 0, lesson_templates: 0, materials: 0, surveys: 0 } }
const guidance = { target: 'tests', blueprint_revision: 4, unit_exception_id: null, unit_label: null, rules_markdown: '', trial: false }

describe('copilot response boundary', () => {
  it.each(['analyze', 'overview', 'outline', 'resources', 'lesson-plans', 'materials', 'surveys', 'grading'] as BlueprintCopilotTarget[])('accepts %s results with empty arrays', (target) => {
    expect(parseCourseBlueprintCopilotResponse({ suggestion: { target, content: '', analysis } }, target).analysis).toEqual(analysis)
  })
  it.each(['tests', 'assignments'] as const)('accepts %s guided drafts with complete provenance and no analysis', (target) => {
    const suggestion = { target, content: 'draft', guidance: { ...guidance, target }, original_content_sha256: 'a'.repeat(64), draft_provenance_token: 'signed' }
    expect(parseCourseBlueprintCopilotResponse({ suggestion }, target)).toEqual(suggestion)
  })
  it.each([
    {}, { suggestion: null },
    { suggestion: { target: 'analyze', content: '', analysis: { ...analysis, suggestions: 'bad' } } },
    { suggestion: { target: 'analyze', content: '', analysis: { ...analysis, missing: undefined } } },
    { suggestion: { target: 'analyze', content: '', analysis: { ...analysis, suggestions: undefined } } },
    { suggestion: { target: 'overview', content: '', analysis } },
  ])('rejects malformed or mismatched analysis responses', (payload) => {
    expect(() => parseCourseBlueprintCopilotResponse(payload, 'analyze')).toThrow()
  })
  it('rejects guided drafts with incomplete or mismatched provenance', () => {
    const base = { target: 'tests', content: 'draft', guidance, original_content_sha256: 'a'.repeat(64), draft_provenance_token: 'signed' }
    expect(() => parseCourseBlueprintCopilotResponse({ suggestion: { ...base, draft_provenance_token: undefined } }, 'tests')).toThrow()
    expect(() => parseCourseBlueprintCopilotResponse({ suggestion: { ...base, guidance: { ...guidance, target: 'assignments' } } }, 'tests')).toThrow()
    expect(() => parseCourseBlueprintCopilotResponse({ suggestion: { ...base, guidance: { ...guidance, trial: 'false' } } }, 'tests')).toThrow()
    expect(() => parseCourseBlueprintCopilotResponse({ suggestion: { ...base, original_content_sha256: 'invalid' } }, 'tests')).toThrow()
  })
})
