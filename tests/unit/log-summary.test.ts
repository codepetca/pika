import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildInitialsMap,
  sanitizeEntryText,
  buildSummaryPrompt,
  restoreNames,
  callOpenAIForSummary,
} from '@/lib/log-summary'

describe('buildInitialsMap', () => {
  it('maps students to initials without collisions', () => {
    const students = [
      { firstName: 'John', lastName: 'Smith' },
      { firstName: 'Alice', lastName: 'Brown' },
    ]
    const result = buildInitialsMap(students)
    expect(result).toEqual({
      'J.S.': 'John Smith',
      'A.B.': 'Alice Brown',
    })
  })

  it('handles collisions by appending index', () => {
    const students = [
      { firstName: 'John', lastName: 'Smith' },
      { firstName: 'Jane', lastName: 'Saunders' },
    ]
    const result = buildInitialsMap(students)
    expect(result).toEqual({
      'J.S.1': 'John Smith',
      'J.S.2': 'Jane Saunders',
    })
  })

  it('handles three-way collisions', () => {
    const students = [
      { firstName: 'John', lastName: 'Smith' },
      { firstName: 'Jane', lastName: 'Saunders' },
      { firstName: 'James', lastName: 'Stone' },
    ]
    const result = buildInitialsMap(students)
    expect(result).toEqual({
      'J.S.1': 'John Smith',
      'J.S.2': 'Jane Saunders',
      'J.S.3': 'James Stone',
    })
  })

  it('returns empty map for empty input', () => {
    expect(buildInitialsMap([])).toEqual({})
  })

  it('handles missing first or last name', () => {
    const students = [{ firstName: '', lastName: 'Smith' }]
    const result = buildInitialsMap(students)
    expect(result).toEqual({ '?.S.': ' Smith' })
  })

  it('deduplicates identical students', () => {
    const students = [
      { firstName: 'John', lastName: 'Smith' },
      { firstName: 'John', lastName: 'Smith' },
    ]
    // Same name appearing twice still gets collision handling
    const result = buildInitialsMap(students)
    expect(Object.values(result)).toEqual(['John Smith', 'John Smith'])
    // Both map to same name, but with different keys
    expect(Object.keys(result).length).toBe(2)
  })
})

describe('sanitizeEntryText', () => {
  const students = [
    { firstName: 'John', lastName: 'Smith' },
    { firstName: 'Alice', lastName: 'Brown' },
  ]
  const initialsMap = {
    'J.S.': 'John Smith',
    'A.B.': 'Alice Brown',
  }

  it('replaces full names with initials', () => {
    const text = 'I worked with John Smith today.'
    const result = sanitizeEntryText(text, students, initialsMap)
    expect(result).toBe('I worked with J.S. today.')
  })

  it('replaces first names with initials', () => {
    const text = 'John helped me with the project.'
    const result = sanitizeEntryText(text, students, initialsMap)
    expect(result).toBe('J.S. helped me with the project.')
  })

  it('replaces last names with initials', () => {
    const text = 'I asked Smith for help.'
    const result = sanitizeEntryText(text, students, initialsMap)
    expect(result).toBe('I asked J.S. for help.')
  })

  it('is case-insensitive', () => {
    const text = 'JOHN SMITH and john smith are the same.'
    const result = sanitizeEntryText(text, students, initialsMap)
    expect(result).toBe('J.S. and J.S. are the same.')
  })

  it('does not replace partial word matches', () => {
    const text = 'Johnson is not the same as John.'
    const result = sanitizeEntryText(text, students, initialsMap)
    expect(result).toBe('Johnson is not the same as J.S..')
  })

  it('handles text with no names', () => {
    const text = 'Today I learned about math.'
    const result = sanitizeEntryText(text, students, initialsMap)
    expect(result).toBe('Today I learned about math.')
  })

  it('handles shared last names between students', () => {
    const sharedStudents = [
      { firstName: 'John', lastName: 'Smith' },
      { firstName: 'Alice', lastName: 'Smith' },
    ]
    const sharedMap = {
      'J.S.': 'John Smith',
      'A.S.': 'Alice Smith',
    }
    // Full name replacement is unambiguous
    const text = 'I worked with John Smith and Alice Smith.'
    const result = sanitizeEntryText(text, sharedStudents, sharedMap)
    expect(result).toBe('I worked with J.S. and A.S..')
  })
})

describe('buildSummaryPrompt', () => {
  it('returns system and user prompts', () => {
    const logs = [
      { initials: 'J.S.', text: 'I worked on the project.' },
      { initials: 'A.B.', text: 'I had trouble with the assignment.' },
    ]
    const { system, user } = buildSummaryPrompt('2025-01-15', logs)
    expect(system).toContain('teaching assistant')
    expect(system).toContain('JSON array')
    expect(user).toContain('2025-01-15')
    expect(user).toContain('[J.S.]: I worked on the project.')
    expect(user).toContain('[A.B.]: I had trouble with the assignment.')
  })

  it('includes all required type tags in system prompt', () => {
    const { system } = buildSummaryPrompt('2025-01-15', [])
    expect(system).toContain('question')
    expect(system).toContain('suggestion')
    expect(system).toContain('concern')
    expect(system).toContain('reflection')
  })
})

describe('restoreNames', () => {
  const initialsMap = {
    'J.S.': 'John Smith',
    'A.B.': 'Alice Brown',
  }

  it('replaces initials in text with full names', () => {
    const items = [
      { text: 'J.S. asked about the homework deadline.', type: 'question', initials: 'J.S.' },
    ]
    const result = restoreNames(items, initialsMap)
    expect(result).toEqual([
      {
        text: 'John Smith asked about the homework deadline.',
        type: 'question',
        studentName: 'John Smith',
      },
    ])
  })

  it('maps studentName from initials', () => {
    const items = [
      { text: 'Showed great progress.', type: 'reflection', initials: 'A.B.' },
    ]
    const result = restoreNames(items, initialsMap)
    expect(result[0].studentName).toBe('Alice Brown')
  })

  it('falls back to initials for unknown mappings', () => {
    const items = [
      { text: 'Unknown student.', type: 'concern', initials: 'X.Y.' },
    ]
    const result = restoreNames(items, initialsMap)
    expect(result[0].studentName).toBe('X.Y.')
  })

  it('defaults invalid type to reflection', () => {
    const items = [
      { text: 'Some text.', type: 'invalid_type', initials: 'J.S.' },
    ]
    const result = restoreNames(items, initialsMap)
    expect(result[0].type).toBe('reflection')
  })

  it('handles collision initials without corruption (J.S.1 vs J.S.)', () => {
    const collisionMap = {
      'J.S.1': 'John Smith',
      'J.S.2': 'Jane Saunders',
    }
    const items = [
      { text: 'J.S.1 and J.S.2 worked together.', type: 'reflection', initials: 'J.S.1' },
    ]
    const result = restoreNames(items, collisionMap)
    expect(result[0].text).toBe('John Smith and Jane Saunders worked together.')
    expect(result[0].studentName).toBe('John Smith')
  })
})

describe('callOpenAIForSummary', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, OPENAI_API_KEY: 'test-key' }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('throws when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY
    await expect(
      callOpenAIForSummary('system', 'user')
    ).rejects.toThrow('OPENAI_API_KEY is not configured')
  })

  it('calls OpenAI and parses JSON response', async () => {
    const mockResponse = [
      { text: 'Student asked about deadline.', type: 'question', initials: 'J.S.' },
    ]

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ output_text: JSON.stringify(mockResponse) }),
    } as Response)

    const result = await callOpenAIForSummary('system prompt', 'user prompt')
    expect(result).toEqual(mockResponse)
  })

  it('handles markdown code block in response', async () => {
    const mockResponse = [{ text: 'Test.', type: 'reflection', initials: 'A.B.' }]
    const wrappedResponse = '```json\n' + JSON.stringify(mockResponse) + '\n```'

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ output_text: wrappedResponse }),
    } as Response)

    const result = await callOpenAIForSummary('system', 'user')
    expect(result).toEqual(mockResponse)
  })

  it('throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as Response)

    await expect(
      callOpenAIForSummary('system', 'user')
    ).rejects.toThrow('OpenAI request failed (500)')
  })

  it('throws on invalid JSON response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ output_text: 'not valid json' }),
    } as Response)

    await expect(
      callOpenAIForSummary('system', 'user')
    ).rejects.toThrow('Failed to parse summary response as JSON')
  })

  it('throws when response is not an array', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ output_text: '{"text": "not an array"}' }),
    } as Response)

    await expect(
      callOpenAIForSummary('system', 'user')
    ).rejects.toThrow('Expected JSON array from OpenAI summary response')
  })
})
