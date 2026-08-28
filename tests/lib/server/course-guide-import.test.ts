import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractCourseGuideImportDraft } from '@/lib/server/course-guide-import'

describe('course guide curriculum extraction', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key'
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_CURRICULUM_IMPORT_MODEL
    vi.restoreAllMocks()
  })

  it('sends a non-stored structured file request and returns a sourced draft', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      model: 'gpt-5-mini',
      output_text: JSON.stringify({
        document_title: 'Computer Studies, Grades 10 to 12',
        overview_markdown: 'A factual overview.',
        expectations_markdown: '- A1. Plan a project.',
        source_links: [{ title: 'Ministry page', url: 'https://example.ca/source' }],
      }),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await extractCourseGuideImportDraft({
      type: 'file',
      filename: 'curriculum.pdf',
      dataUrl: 'data:application/pdf;base64,JVBERi0=',
    })

    expect(result.sourceLabel).toContain('curriculum.pdf')
    expect(result.sourceFilename).toBe('curriculum.pdf')
    expect(result.draftMarkdown).not.toContain('Source:')
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body))
    expect(body).toMatchObject({
      model: 'gpt-5-mini',
      store: false,
      text: { format: { type: 'json_schema', strict: true } },
    })
    expect(body.input[1].content[1]).toMatchObject({
      type: 'input_file',
      filename: 'curriculum.pdf',
      detail: 'low',
    })
  })

  it('passes public URLs as file inputs without Pika fetching them', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      output_text: JSON.stringify({
        document_title: 'Public curriculum',
        overview_markdown: 'Overview',
        expectations_markdown: '',
        source_links: [],
      }),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await extractCourseGuideImportDraft({ type: 'url', url: 'https://example.ca/curriculum.pdf' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))
    expect(body.input[1].content[1]).toEqual({
      type: 'input_file',
      file_url: 'https://example.ca/curriculum.pdf',
      detail: 'low',
    })
  })

  it('fails closed when the model response is incomplete or invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(extractCourseGuideImportDraft({
      type: 'url',
      url: 'https://example.ca/curriculum.pdf',
    })).rejects.toThrow('The curriculum extraction was incomplete')
  })
})
