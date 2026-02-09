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
    expect(system).toContain('overview')
    expect(system).toContain('action_items')
    expect(user).toContain('2025-01-15')
    expect(user).toContain('[J.S.]: I worked on the project.')
    expect(user).toContain('[A.B.]: I had trouble with the assignment.')
  })

  it('mentions teacher attention in system prompt', () => {
    const { system } = buildSummaryPrompt('2025-01-15', [])
    expect(system).toContain('teacher attention')
    expect(system).toContain('struggling')
  })
})

describe('restoreNames', () => {
  const initialsMap = {
    'J.S.': 'John Smith',
    'A.B.': 'Alice Brown',
  }

  it('replaces initials in overview with full names', () => {
    const raw = {
      overview: 'J.S. and A.B. are doing well.',
      action_items: [],
    }
    const result = restoreNames(raw, initialsMap)
    expect(result.overview).toBe('John Smith and Alice Brown are doing well.')
  })

  it('replaces initials in action item text', () => {
    const raw = {
      overview: 'Students are doing well.',
      action_items: [
        { text: 'J.S. needs help with fractions.', initials: 'J.S.' },
      ],
    }
    const result = restoreNames(raw, initialsMap)
    expect(result.action_items[0].text).toBe('John Smith needs help with fractions.')
    expect(result.action_items[0].studentName).toBe('John Smith')
  })

  it('falls back to initials for unknown mappings', () => {
    const raw = {
      overview: 'Students are fine.',
      action_items: [
        { text: 'Unknown student issue.', initials: 'X.Y.' },
      ],
    }
    const result = restoreNames(raw, initialsMap)
    expect(result.action_items[0].studentName).toBe('X.Y.')
  })

  it('handles collision initials without corruption (J.S.1 vs J.S.)', () => {
    const collisionMap = {
      'J.S.1': 'John Smith',
      'J.S.2': 'Jane Saunders',
    }
    const raw = {
      overview: 'J.S.1 and J.S.2 worked together.',
      action_items: [
        { text: 'J.S.1 needs more practice.', initials: 'J.S.1' },
      ],
    }
    const result = restoreNames(raw, collisionMap)
    expect(result.overview).toBe('John Smith and Jane Saunders worked together.')
    expect(result.action_items[0].text).toBe('John Smith needs more practice.')
    expect(result.action_items[0].studentName).toBe('John Smith')
  })

  it('returns empty action_items when none provided', () => {
    const raw = {
      overview: 'Everyone is doing well.',
      action_items: [],
    }
    const result = restoreNames(raw, initialsMap)
    expect(result.action_items).toEqual([])
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
    const mockResponse = {
      overview: 'Students are doing well overall.',
      action_items: [
        { text: 'J.S. asked about deadline.', initials: 'J.S.' },
      ],
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ output_text: JSON.stringify(mockResponse) }),
    } as Response)

    const result = await callOpenAIForSummary('system prompt', 'user prompt')
    expect(result.overview).toBe('Students are doing well overall.')
    expect(result.action_items).toEqual([
      { text: 'J.S. asked about deadline.', initials: 'J.S.' },
    ])
  })

  it('handles markdown code block in response', async () => {
    const mockResponse = {
      overview: 'Test overview.',
      action_items: [],
    }
    const wrappedResponse = '```json\n' + JSON.stringify(mockResponse) + '\n```'

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ output_text: wrappedResponse }),
    } as Response)

    const result = await callOpenAIForSummary('system', 'user')
    expect(result.overview).toBe('Test overview.')
    expect(result.action_items).toEqual([])
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

  it('throws when response is an array instead of object', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ output_text: '[{"text": "item"}]' }),
    } as Response)

    await expect(
      callOpenAIForSummary('system', 'user')
    ).rejects.toThrow('Expected JSON object with overview and action_items')
  })
})
