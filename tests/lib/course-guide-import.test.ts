import { describe, expect, it } from 'vitest'
import {
  addCourseGuideImportCitation,
  appendCourseGuideImport,
  buildCourseGuideImportDraft,
} from '@/lib/course-guide-import'
import { parseLimitedMarkdownBlocks } from '@/lib/limited-markdown'
import {
  COURSE_GUIDE_IMPORT_MAX_FILE_BYTES,
  courseGuideImportMetadataSchema,
  decodeCourseGuideImportFormData,
} from '@/lib/validations/course-guide-import'

describe('course guide curriculum import', () => {
  it('builds a sourced draft and removes unsafe or duplicate model links', () => {
    const draft = buildCourseGuideImportDraft({
      model: {
        document_title: 'Ontario Computer Studies',
        overview_markdown: 'Students learn computational thinking.',
        expectations_markdown: '- A1. Use project management skills.',
        source_links: [
          { title: 'Ontario curriculum', url: 'https://example.ca/curriculum' },
          { title: 'Duplicate', url: 'https://example.ca/curriculum' },
          { title: 'Unsafe', url: 'javascript:alert(1)' },
        ],
      },
      sourceUrl: 'https://example.ca/document.pdf',
      sourceFilename: null,
    })

    expect(draft.sourceLinks).toEqual([
      { title: 'Ontario curriculum', url: 'https://example.ca/curriculum' },
    ])
    expect(draft.draftMarkdown).toContain('## Curriculum overview')
    expect(draft.draftMarkdown).toContain('## Expectations')
    expect(draft.draftMarkdown).toContain('[Ontario curriculum](https://example.ca/curriculum)')
    expect(draft.sourceFilename).toBeNull()
    expect(draft.draftMarkdown).not.toContain('Source:')
  })

  it('adds a source citation after the reviewed content', () => {
    expect(addCourseGuideImportCitation({
      reviewedDraftMarkdown: 'Teacher-reviewed draft',
      citationMarkdown: 'Source: Ontario Computer Studies — https://example.ca/document_(final).pdf',
    })).toBe(
      'Teacher-reviewed draft\n\nSource: Ontario Computer Studies — https://example.ca/document_(final).pdf',
    )
  })

  it('normalizes hostile provenance into one safe LimitedMarkdown paragraph', () => {
    const draft = buildCourseGuideImportDraft({
      model: {
        document_title: 'Official\u202e curriculum\n\n# *Unreviewed* [directive]',
        overview_markdown: 'Overview',
        expectations_markdown: '',
        source_links: [],
      },
      sourceUrl: 'https://example.ca/document_(final).pdf',
      sourceFilename: null,
    })

    expect(draft.sourceTitle).toBe('Official curriculum Unreviewed directive')
    expect(draft.citationMarkdown).toBe(
      'Source: Official curriculum Unreviewed directive — https://example.ca/document_(final).pdf',
    )
    expect(draft.citationMarkdown).not.toContain('\n')
    expect(parseLimitedMarkdownBlocks(draft.citationMarkdown)).toEqual([{
      type: 'paragraph',
      text: draft.citationMarkdown,
    }])

    const uploaded = buildCourseGuideImportDraft({
      model: {
        document_title: 'Official curriculum',
        overview_markdown: 'Overview',
        expectations_markdown: '',
        source_links: [],
      },
      sourceUrl: null,
      sourceFilename: 'curriculum\u202Efdp.pdf\n# heading',
    })
    expect(uploaded.sourceFilename).toBe('curriculum fdp.pdf heading')
    expect(uploaded.citationMarkdown).not.toMatch(/[\n\u202E]/u)
  })

  it('appends a reviewed draft without replacing teacher content', () => {
    expect(appendCourseGuideImport('Teacher-authored overview', 'Imported draft')).toBe(
      'Teacher-authored overview\n\n---\n\nImported draft',
    )
    expect(appendCourseGuideImport('', 'Imported draft')).toBe('Imported draft')
    expect(appendCourseGuideImport('  indented teacher content\n', 'Imported draft')).toBe(
      '  indented teacher content\n\n\n---\n\nImported draft',
    )
  })

  it('accepts a real PDF upload and rejects spoofed PDFs', async () => {
    const metadata = courseGuideImportMetadataSchema.parse({ sourceType: 'file', sourceUrl: '' })
    const valid = new FormData()
    valid.set('file', new File(['%PDF-1.7 curriculum'], 'curriculum.pdf', {
      type: 'application/pdf',
    }))

    await expect(decodeCourseGuideImportFormData(valid, metadata)).resolves.toMatchObject({
      type: 'file',
      filename: 'curriculum.pdf',
      dataUrl: expect.stringMatching(/^data:application\/pdf;base64,/),
    })

    const validWithLeadingComment = new FormData()
    validWithLeadingComment.set('file', new File(['comment\n%PDF-1.7 curriculum'], 'curriculum.pdf', {
      type: 'application/pdf',
    }))
    await expect(decodeCourseGuideImportFormData(validWithLeadingComment, metadata)).resolves.toMatchObject({
      type: 'file',
    })

    const spoofed = new FormData()
    spoofed.set('file', new File(['not a pdf'], 'curriculum.pdf', {
      type: 'application/pdf',
    }))
    await expect(decodeCourseGuideImportFormData(spoofed, metadata)).rejects.toThrow(
      'The selected file is not a valid PDF',
    )

    const oversized = new FormData()
    oversized.set('file', new File([
      '%PDF-',
      new Uint8Array(COURSE_GUIDE_IMPORT_MAX_FILE_BYTES),
    ], 'curriculum.pdf', { type: 'application/pdf' }))
    await expect(decodeCourseGuideImportFormData(oversized, metadata)).rejects.toThrow(
      'The PDF must be 4 MB or smaller',
    )
  })

  it('allows public HTTPS document URLs and blocks local or literal hosts', () => {
    expect(courseGuideImportMetadataSchema.safeParse({
      sourceType: 'url',
      sourceUrl: 'https://www.dcp.edu.gov.on.ca/en/curriculum/computer-studies',
    }).success).toBe(true)
    expect(courseGuideImportMetadataSchema.safeParse({
      sourceType: 'url',
      sourceUrl: 'http://localhost/curriculum.pdf',
    }).success).toBe(false)
    expect(courseGuideImportMetadataSchema.safeParse({
      sourceType: 'url',
      sourceUrl: 'https://127.0.0.1/curriculum.pdf',
    }).success).toBe(false)
    expect(courseGuideImportMetadataSchema.safeParse({
      sourceType: 'url',
      sourceUrl: 'https://user:secret@example.ca/curriculum.pdf',
    }).success).toBe(false)
    expect(courseGuideImportMetadataSchema.safeParse({
      sourceType: 'url',
      sourceUrl: 'https://example.ca/a\n\n# locked-heading',
    }).success).toBe(false)
    expect(courseGuideImportMetadataSchema.parse({
      sourceType: 'url',
      sourceUrl: 'https://EXAMPLE.ca/curriculum page.pdf',
    }).sourceUrl).toBe('https://example.ca/curriculum%20page.pdf')
  })
})
