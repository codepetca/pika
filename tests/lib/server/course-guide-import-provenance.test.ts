import { beforeEach, describe, expect, it } from 'vitest'
import {
  createCourseGuideImportProvenanceToken,
  verifyCourseGuideImportProvenanceToken,
} from '@/lib/server/course-guide-import-provenance'

const draft = {
  sourceTitle: 'Ontario curriculum',
  sourceUrl: 'https://example.ca/curriculum_(final).pdf',
  sourceFilename: null,
  sourceLabel: 'Ontario curriculum — https://example.ca/curriculum_(final).pdf',
  overviewMarkdown: 'Overview',
  expectationsMarkdown: 'Expectations',
  sourceLinks: [],
  draftMarkdown: '## Curriculum overview\n\nOverview',
  citationMarkdown: 'Source: Ontario curriculum — https://example.ca/curriculum_(final).pdf',
}

describe('course guide import provenance', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough'
  })

  it('binds the source citation to the teacher and classroom', () => {
    const token = createCourseGuideImportProvenanceToken({
      teacherId: 'teacher-1',
      classroomId: 'classroom-1',
      draft,
      nowMs: 1_000,
    })

    expect(verifyCourseGuideImportProvenanceToken({
      token,
      teacherId: 'teacher-1',
      classroomId: 'classroom-1',
      nowMs: 2_000,
    })).toEqual(expect.objectContaining({ citationMarkdown: draft.citationMarkdown }))
    expect(verifyCourseGuideImportProvenanceToken({
      token,
      teacherId: 'teacher-2',
      classroomId: 'classroom-1',
      nowMs: 2_000,
    })).toBeNull()
    expect(verifyCourseGuideImportProvenanceToken({
      token,
      teacherId: 'teacher-1',
      classroomId: 'classroom-2',
      nowMs: 2_000,
    })).toBeNull()
  })

  it('rejects tampered and expired provenance', () => {
    const token = createCourseGuideImportProvenanceToken({
      teacherId: 'teacher-1',
      classroomId: 'classroom-1',
      draft,
      nowMs: 1_000,
    })
    const [payload, signature] = token.split('.')
    const tampered = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`

    expect(verifyCourseGuideImportProvenanceToken({
      token: `${payload}.${tampered}`,
      teacherId: 'teacher-1',
      classroomId: 'classroom-1',
      nowMs: 2_000,
    })).toBeNull()
    expect(verifyCourseGuideImportProvenanceToken({
      token,
      teacherId: 'teacher-1',
      classroomId: 'classroom-1',
      nowMs: 30 * 60 * 1000 + 1_001,
    })).toBeNull()
  })

  it('round-trips the maximum supported public URL within the token bound', () => {
    const prefix = 'https://example.ca/'
    const sourceUrl = `${prefix}${'a'.repeat(2048 - prefix.length)}`
    const longDraft = {
      ...draft,
      sourceTitle: 'T'.repeat(300),
      sourceUrl,
      sourceLabel: `${'T'.repeat(300)} — ${sourceUrl}`,
      citationMarkdown: `Source: ${'T'.repeat(300)} — ${sourceUrl}`,
    }
    const token = createCourseGuideImportProvenanceToken({
      teacherId: 'teacher-1',
      classroomId: 'classroom-1',
      draft: longDraft,
      nowMs: 1_000,
    })

    expect(token.length).toBeLessThanOrEqual(4096)
    expect(verifyCourseGuideImportProvenanceToken({
      token,
      teacherId: 'teacher-1',
      classroomId: 'classroom-1',
      nowMs: 2_000,
    })).toEqual({ citationMarkdown: longDraft.citationMarkdown })
  })
})
