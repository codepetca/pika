import { describe, expect, it } from 'vitest'
import {
  buildInitialsMap,
  createProviderRefMap,
  mapProviderRefToLocalId,
  redactDirectIdentifiers,
  sanitizeAiEgressRecord,
  sanitizeAiOutputText,
  sanitizeAiText,
  sanitizeTextWithStudentNames,
} from '@/lib/ai-sanitization'

describe('ai-sanitization', () => {
  it('redacts direct identifiers used in AI egress payloads', () => {
    const text = [
      'Email alex@example.com.',
      'Call 416-555-1212.',
      'Student number 123456789.',
      'Lives at 123 Main Street.',
      'Open https://example.com/work.',
      'Internal id 018f3f57-7b4b-7123-8c04-48ac061c1111.',
    ].join(' ')

    expect(redactDirectIdentifiers(text)).toBe(
      [
        'Email [email redacted].',
        'Call [phone redacted].',
        '[student number redacted].',
        'Lives at [address redacted].',
        'Open [url redacted]',
        'Internal id [id redacted].',
      ].join(' ')
    )
  })

  it('replaces known student names and direct identifiers before provider egress', () => {
    const students = [
      { firstName: 'Alice', lastName: 'Brown' },
      { firstName: 'Bob', lastName: 'Carter' },
    ]
    const initialsMap = buildInitialsMap(students)

    const sanitized = sanitizeTextWithStudentNames(
      'Alice Brown worked with Bob and shared bob@example.com.',
      students,
      initialsMap,
    )

    expect(sanitized).toBe('A.B. worked with B.C. and shared [email redacted].')
  })

  it('falls back to direct identifier redaction without a roster map', () => {
    expect(sanitizeAiText('Contact me at alex@example.com.')).toBe('Contact me at [email redacted].')
  })

  it('sanitizes provider output before local persistence', () => {
    expect(sanitizeAiOutputText('Next Step: email alex@example.com.')).toBe(
      'Next Step: email [email redacted].'
    )
  })

  it('creates local-only provider refs and maps them back', () => {
    const refs = createProviderRefMap(
      [
        { localId: '018f3f57-7b4b-7123-8c04-48ac061c1111', responseText: 'One' },
        { localId: '018f3f57-7b4b-7123-8c04-48ac061c2222', responseText: 'Two' },
      ],
      'response',
    )

    expect(refs.map((ref) => ref.providerRef)).toEqual(['response_1', 'response_2'])
    expect(mapProviderRefToLocalId(refs).get('response_2')).toBe(
      '018f3f57-7b4b-7123-8c04-48ac061c2222'
    )
  })

  it('rejects unexpected adapter egress fields', () => {
    expect(() =>
      sanitizeAiEgressRecord(
        {
          prompt: 'Grade this',
          student_id: '018f3f57-7b4b-7123-8c04-48ac061c1111',
        },
        ['prompt'],
      )
    ).toThrow('Unexpected AI egress field: student_id')
  })
})
