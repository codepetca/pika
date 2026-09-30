import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createClassroomDraftProvenanceToken,
  hashClassroomDraftContent,
  verifyClassroomDraftProvenanceToken,
} from '@/lib/server/classroom-draft-provenance'

const provenance = {
  source_blueprint_version_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  source_blueprint_version_number: 2,
  source_draft_revision: 5,
  target: 'tests' as const,
  unit_exception_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  unit_label: 'Unit 1',
  rules_markdown: 'Frozen rules',
}
const seedContentSha256 = hashClassroomDraftContent('Original preview')
const args = {
  teacherId: 'teacher-1', classroomId: 'classroom-1',
  draftId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  provenance, seedContentSha256,
}

afterEach(() => vi.unstubAllEnvs())

describe('classroom draft provenance token', () => {
  it('binds teacher, classroom, draft, frozen Version, unit, rules, and seed', () => {
    vi.stubEnv('SESSION_SECRET', 'test-session-secret-with-at-least-32-characters')
    const token = createClassroomDraftProvenanceToken({ ...args, nowMs: 1000 })
    expect(verifyClassroomDraftProvenanceToken({ token, ...args, nowMs: 2000 })).toBe(true)
    expect(verifyClassroomDraftProvenanceToken({ token, ...args, teacherId: 'other', nowMs: 2000 })).toBe(false)
    expect(verifyClassroomDraftProvenanceToken({ token, ...args, classroomId: 'other', nowMs: 2000 })).toBe(false)
    expect(verifyClassroomDraftProvenanceToken({ token, ...args, draftId: crypto.randomUUID(), nowMs: 2000 })).toBe(false)
    expect(verifyClassroomDraftProvenanceToken({ token, ...args, provenance: {
      ...provenance, rules_markdown: 'Live Draft rules',
    }, nowMs: 2000 })).toBe(false)
    expect(verifyClassroomDraftProvenanceToken({ token, ...args, seedContentSha256: hashClassroomDraftContent('Other preview'), nowMs: 2000 })).toBe(false)
  })

  it('rejects trial, tampered, and expired tokens', () => {
    vi.stubEnv('SESSION_SECRET', 'test-session-secret-with-at-least-32-characters')
    const trial = createClassroomDraftProvenanceToken({ ...args, trial: true, nowMs: 1000 })
    expect(verifyClassroomDraftProvenanceToken({ token: trial, ...args, nowMs: 2000 })).toBe(false)
    const token = createClassroomDraftProvenanceToken({ ...args, nowMs: 1000 })
    expect(verifyClassroomDraftProvenanceToken({ token: `${token}x`, ...args, nowMs: 2000 })).toBe(false)
    expect(verifyClassroomDraftProvenanceToken({ token, ...args, nowMs: 31 * 60 * 1000 })).toBe(false)
  })
  it('rejects changed structural context when effective guidance is unchanged', () => {
    vi.stubEnv('SESSION_SECRET', 'test-session-secret-with-at-least-32-characters')
    const split = { ...provenance, content_version_id: 'structural-v3' }
    const token = createClassroomDraftProvenanceToken({ ...args, provenance: split })
    expect(verifyClassroomDraftProvenanceToken({ ...args, token, provenance: split })).toBe(true)
    expect(verifyClassroomDraftProvenanceToken({ ...args, token,
      provenance: { ...split, content_version_id: provenance.source_blueprint_version_id },
    })).toBe(false)
    const legacy = createClassroomDraftProvenanceToken(args)
    expect(verifyClassroomDraftProvenanceToken({ ...args, token: legacy,
      provenance: { ...provenance, content_version_id: provenance.source_blueprint_version_id },
    })).toBe(true)
    expect(verifyClassroomDraftProvenanceToken({ ...args, token: legacy, provenance: split })).toBe(false)
  })

})
