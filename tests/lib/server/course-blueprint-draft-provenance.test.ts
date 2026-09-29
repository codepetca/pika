import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCourseBlueprintDraftProvenanceToken,
  hashCourseBlueprintDraftContent,
  verifyCourseBlueprintDraftProvenanceToken,
} from '@/lib/server/course-blueprint-draft-provenance'
import type { CourseBlueprintDraftGuidanceProvenance } from '@/lib/course-blueprint-authoring-context'

const provenance: CourseBlueprintDraftGuidanceProvenance = {
  blueprint_revision: 7,
  target: 'tests',
  unit_exception_id: null,
  unit_label: null,
  rules_markdown: 'Saved rule A',
}
const identity = {
  teacherId: 'teacher-1',
  blueprintId: 'blueprint-1',
  provenance,
  generatedContentSha256: hashCourseBlueprintDraftContent('Original model draft'),
}

afterEach(() => vi.unstubAllEnvs())

describe('guided Blueprint draft provenance', () => {
  it('accepts a saved-guidance preview and binds its origin to the teacher and generated text', () => {
    vi.stubEnv('SESSION_SECRET', 'test-session-secret-with-at-least-32-characters')
    const token = createCourseBlueprintDraftProvenanceToken({ ...identity, trial: false, nowMs: 1000 })
    expect(verifyCourseBlueprintDraftProvenanceToken({ ...identity, token, nowMs: 1001 })).toBe(true)
    expect(verifyCourseBlueprintDraftProvenanceToken({ ...identity, token, teacherId: 'another', nowMs: 1001 })).toBe(false)
    expect(verifyCourseBlueprintDraftProvenanceToken({
      ...identity, token,
      generatedContentSha256: hashCourseBlueprintDraftContent('changed seed'), nowMs: 1001,
    })).toBe(false)
    expect(verifyCourseBlueprintDraftProvenanceToken({ ...identity, token, nowMs: 31 * 60 * 1000 })).toBe(false)
  })

  it('rejects trial guidance B even when the saved Blueprint is still at the same revision', () => {
    vi.stubEnv('SESSION_SECRET', 'test-session-secret-with-at-least-32-characters')
    const trialProvenance = { ...provenance, rules_markdown: 'Unsaved trial rule B' }
    const token = createCourseBlueprintDraftProvenanceToken({
      ...identity, provenance: trialProvenance, trial: true, nowMs: 1000,
    })
    expect(verifyCourseBlueprintDraftProvenanceToken({ ...identity, token, nowMs: 1001 })).toBe(false)
    expect(verifyCourseBlueprintDraftProvenanceToken({
      ...identity, provenance: trialProvenance, token, nowMs: 1001,
    })).toBe(false)
  })
})
