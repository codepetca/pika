import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildDeveloperFeedbackPrompt,
  callOpenAIForDeveloperFeedback,
  normalizeDeveloperFeedbackDedupeKey,
  parseDeveloperFeedbackResponse,
  recordDirectDeveloperFeedback,
  recordDeveloperFeedbackCandidates,
} from '@/lib/developer-log-feedback'

describe('developer log feedback extraction', () => {
  it('builds a privacy-preserving product feedback prompt', () => {
    const { system, user } = buildDeveloperFeedbackPrompt('2026-05-19', [
      { initials: 'A.B.', text: 'Pika should warn me before I lose a daily log draft.' },
    ])

    expect(system).toContain('product triage assistant for Pika')
    expect(system).toContain('Do not quote student logs verbatim')
    expect(system).toContain('Return ONLY valid JSON')
    expect(user).toContain('2026-05-19')
    expect(user).toContain('[A.B.]')
  })

  it('parses candidate JSON and normalizes invalid agent values', () => {
    const response = parseDeveloperFeedbackResponse(
      JSON.stringify({
        candidates: [
          {
            title: 'Daily log drafts',
            original_request: 'Students are unsure whether daily log drafts are preserved.',
            refined_request: 'Preserve daily log drafts across refresh and navigation.',
            implementation_hint: 'Inspect StudentTodayTab autosave and session cache behavior.',
            affected_area: 'student daily log',
            suggested_agent: 'unknown',
            confidence: 0.87,
            dedupe_key: 'daily-log-draft-preservation',
          },
        ],
      })
    )

    expect(response.candidates).toEqual([
      expect.objectContaining({
        title: 'Daily log drafts',
        suggested_agent: 'codex',
        confidence: 0.87,
      }),
    ])
  })

  it('handles markdown-wrapped JSON responses', () => {
    const response = parseDeveloperFeedbackResponse(
      '```json\n{"candidates":[]}\n```'
    )

    expect(response.candidates).toEqual([])
  })

  it('normalizes stable dedupe keys', () => {
    expect(normalizeDeveloperFeedbackDedupeKey(' Student Daily Log: Draft Recovery! ')).toBe(
      'student-daily-log-draft-recovery'
    )
  })
})

describe('recordDeveloperFeedbackCandidates', () => {
  it('inserts high-confidence candidates', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'candidate-1', inserted: true }, error: null })
    const supabase = {
      rpc,
      from: vi.fn(),
    }

    const result = await recordDeveloperFeedbackCandidates(
      supabase,
      [
        {
          title: 'Recover daily log drafts',
          original_request: 'Students want clearer daily log draft recovery.',
          refined_request: 'Preserve daily log drafts across refresh and navigation.',
          affected_area: 'student daily log',
          suggested_agent: 'codex',
          confidence: 0.9,
          dedupe_key: 'daily-log-draft-recovery',
        },
      ],
      {
        classroomId: '11111111-1111-1111-1111-111111111111',
        date: '2026-05-19',
        sourceEntryCount: 12,
        model: 'gpt-test',
      }
    )

    expect(result).toEqual({ inserted: 1, updated: 0, skipped: 0, tableMissing: false })
    expect(rpc).toHaveBeenCalledWith(
      'upsert_developer_feedback_candidate',
      expect.objectContaining({
        p_dedupe_key: 'daily-log-draft-recovery',
        p_source_entry_count: 12,
        p_source_classroom_id: '11111111-1111-1111-1111-111111111111',
        p_source_date: '2026-05-19',
      })
    )
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('merges existing candidates through the atomic upsert RPC without status changes', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'candidate-1', inserted: false }, error: null })
    const supabase = {
      rpc,
      from: vi.fn(),
    }

    const result = await recordDeveloperFeedbackCandidates(
      supabase,
      [
        {
          title: 'Assignment due-date warnings',
          original_request: 'Students want more visible due-date warnings.',
          refined_request: 'Make upcoming and overdue assignment states more visible to students.',
          affected_area: 'assignments',
          suggested_agent: 'either',
          confidence: 0.81,
          dedupe_key: 'assignment-due-date-warnings',
        },
      ],
      {
        classroomId: '22222222-2222-2222-2222-222222222222',
        date: '2026-05-19',
        sourceEntryCount: 9,
        model: 'gpt-test',
      }
    )

    expect(result).toEqual({ inserted: 0, updated: 1, skipped: 0, tableMissing: false })
    expect(rpc).toHaveBeenCalledWith(
      'upsert_developer_feedback_candidate',
      expect.objectContaining({
        p_dedupe_key: 'assignment-due-date-warnings',
        p_source_entry_count: 9,
        p_source_classroom_id: '22222222-2222-2222-2222-222222222222',
        p_source_date: '2026-05-19',
        p_confidence: 0.81,
      })
    )
    const args = rpc.mock.calls[0][1]
    expect(args).not.toHaveProperty('status')
    expect(args).not.toHaveProperty('signal_count')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('skips low-confidence candidates', async () => {
    const supabase = { from: vi.fn() }

    const result = await recordDeveloperFeedbackCandidates(
      supabase,
      [
        {
          title: 'Maybe content help',
          original_request: 'A student asked for assignment help.',
          refined_request: 'A teacher should follow up.',
          confidence: 0.3,
        },
      ],
      {
        classroomId: '11111111-1111-1111-1111-111111111111',
        date: '2026-05-19',
        sourceEntryCount: 3,
        model: 'gpt-test',
      }
    )

    expect(result).toEqual({ inserted: 0, updated: 0, skipped: 1, tableMissing: false })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('reports tableMissing without throwing when the migration has not been applied', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: 'PGRST202',
          message: "Could not find the function 'public.upsert_developer_feedback_candidate' in the schema cache",
        },
      }),
      from: vi.fn(),
    }

    const result = await recordDeveloperFeedbackCandidates(
      supabase,
      [
        {
          title: 'Daily log drafts',
          original_request: 'Students want draft recovery.',
          refined_request: 'Preserve daily log drafts across navigation.',
          confidence: 0.9,
        },
      ],
      {
        classroomId: '11111111-1111-1111-1111-111111111111',
        date: '2026-05-19',
        sourceEntryCount: 3,
        model: 'gpt-test',
      }
    )

    expect(result).toEqual({ inserted: 0, updated: 0, skipped: 1, tableMissing: true })
  })
})

describe('recordDirectDeveloperFeedback', () => {
  it('stores sanitized direct feedback as a new triage candidate', async () => {
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: 'candidate-1' }, error: null }),
      })),
    }))
    const supabase = {
      from: vi.fn(() => ({ insert })),
    }

    const result = await recordDirectDeveloperFeedback(supabase, {
      userId: 'user-1',
      role: 'student',
      category: 'bug',
      description: 'The daily log disappeared. Email me at student@example.com.',
      metadata: {
        url: 'http://localhost:3000/classrooms/1?tab=today',
        userAgent: 'Vitest Browser',
        version: '1.0.0',
        commit: 'abc123',
        env: 'test',
      },
    })

    expect(result).toEqual({ id: 'candidate-1' })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupe_key: expect.stringMatching(/^direct-/),
        source_type: 'direct_feedback',
        direct_feedback_category: 'bug',
        submitter_user_id: 'user-1',
        submitter_role: 'student',
        original_request: 'The daily log disappeared. Email me at [email redacted].',
        refined_request: 'The daily log disappeared. Email me at [email redacted].',
        affected_area: 'classrooms',
        confidence: 1,
        source_metadata: expect.objectContaining({
          url: '/classrooms/[id]?tab=today',
        }),
      })
    )
  })
})

describe('callOpenAIForDeveloperFeedback', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, OPENAI_API_KEY: 'test-key' }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('calls OpenAI with store=false and parses candidates', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          candidates: [
            {
              title: 'Returned feedback visibility',
              original_request: 'Students have trouble finding returned comments.',
              refined_request: 'Improve visibility of returned assignment feedback.',
              confidence: 0.88,
            },
          ],
        }),
      }),
    } as Response)

    const result = await callOpenAIForDeveloperFeedback('system', 'user')

    expect(result.candidates).toHaveLength(1)
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(requestInit.body))
    expect(body.store).toBe(false)
  })
})
