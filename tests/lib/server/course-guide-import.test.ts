import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractCourseGuideImportDraft } from '@/lib/server/course-guide-import'

const mocks = vi.hoisted(() => ({
  fetchSafeExternalDocument: vi.fn(),
}))

vi.mock('@/lib/server/safe-external-document', () => ({
  fetchSafeExternalDocument: mocks.fetchSafeExternalDocument,
}))

describe('course guide curriculum extraction', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('OPENAI_CURRICULUM_IMPORT_MODEL', undefined)
    mocks.fetchSafeExternalDocument.mockResolvedValue({
      body: Buffer.from('%PDF-1.7 curriculum'),
      finalUrl: 'https://example.ca/curriculum.pdf',
      headers: new Headers({ 'content-type': 'application/pdf' }),
      status: 200,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('sends a non-stored structured file request and returns a sourced draft', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      model: 'gpt-6.1-sol',
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
    expect(result.citationMarkdown).toBe(
      'Source: Computer Studies, Grades 10 to 12 — curriculum.pdf',
    )
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body))
    expect(body).toMatchObject({
      model: 'gpt-6.1-sol',
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 8000,
      text: { format: { type: 'json_schema', strict: true } },
    })
    expect(request.signal).toBeInstanceOf(AbortSignal)
    expect(body.input[1].content[1]).toMatchObject({
      type: 'input_file',
      filename: 'curriculum.pdf',
      detail: 'low',
    })
  })

  it('fetches bounded public documents and honors the explicit model override', async () => {
    vi.stubEnv('OPENAI_CURRICULUM_IMPORT_MODEL', ' gpt-5-mini ')
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

    expect(mocks.fetchSafeExternalDocument).toHaveBeenCalledWith(
      'https://example.ca/curriculum.pdf',
      4 * 1024 * 1024,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))
    expect(body.model).toBe('gpt-5-mini')
    expect(body).not.toHaveProperty('reasoning')
    expect(body.input[1].content[1]).toEqual({
      type: 'input_file',
      filename: 'curriculum.pdf',
      file_data: expect.stringMatching(/^data:application\/pdf;base64,/),
      detail: 'low',
    })
  })

  it('rejects oversized public URL content before calling OpenAI', async () => {
    mocks.fetchSafeExternalDocument.mockRejectedValue(new Error('Document is too large to sync'))
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(extractCourseGuideImportDraft({
      type: 'url',
      url: 'https://example.ca/curriculum.pdf',
    })).rejects.toThrow('Document is too large to sync')

    expect(fetchMock).not.toHaveBeenCalled()
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

  it('maps provider timeouts to a bounded extraction failure', async () => {
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(timeout)

    await expect(extractCourseGuideImportDraft({
      type: 'url',
      url: 'https://example.ca/curriculum.pdf',
    })).rejects.toThrow('The curriculum extraction timed out')
  })
})
