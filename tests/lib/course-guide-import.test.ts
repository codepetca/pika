import { describe, expect, it } from 'vitest'
import {
  addCourseGuideImportCitation,
  appendCourseGuideImport,
  buildCourseGuideImportDraft,
} from '@/lib/course-guide-import'
import {
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
      sourceTitle: 'Ontario Computer Studies',
      sourceUrl: 'https://example.ca/document_(final).pdf',
      sourceFilename: null,
    })).toBe(
      'Teacher-reviewed draft\n\nSource: [Ontario Computer Studies](<https://example.ca/document_(final).pdf>)',
    )
  })

  it('appends a reviewed draft without replacing teacher content', () => {
    expect(appendCourseGuideImport('Teacher-authored overview', 'Imported draft')).toBe(
      'Teacher-authored overview\n\n---\n\nImported draft',
    )
    expect(appendCourseGuideImport('', 'Imported draft')).toBe('Imported draft')
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
  })
})
