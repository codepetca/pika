import { describe, expect, it } from 'vitest'
import {
  buildInitialsMap,
  buildAiSanitizationContext,
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

  it.each([
    ['Élodie', 'Gagné'],
    ['Мария', 'Иванова'],
    ['عائشة', 'محمود'],
    ['小明', '王'],
  ])('redacts standalone Unicode names for %s %s in one pass', (firstName, lastName) => {
    const context = buildAiSanitizationContext([{ firstName, lastName }])
    const initials = Object.keys(context.initialsMap)[0]
    expect(sanitizeAiText(`${firstName} wrote with ${lastName}. ${firstName} ${lastName}!`, context))
      .toBe(`${initials} wrote with ${initials}. ${initials}!`)
  })

  it('matches canonically equivalent accents and case without mutating the roster', () => {
    const context = buildAiSanitizationContext([{ firstName: 'Élodie', lastName: 'Gagné' }])
    const before = structuredClone(context)
    expect(sanitizeAiText('E\u0301LODIE and gagne\u0301.', context)).toBe('É.G. and É.G..')
    expect(context).toEqual(before)
    const decomposedRoster = buildAiSanitizationContext([
      { firstName: 'E\u0301lodie', lastName: 'Gagne\u0301' },
    ])
    expect(sanitizeAiText('Élodie Gagné; Élodie', decomposedRoster)).toBe('É.G.; É.G.')
  })

  it.each([
    ['İpek', 'Yılmaz', 'ipek YILMAZ; İPEK; i\u0307pek; IPEK'],
    ['Straße', 'Müller', 'STRASSE MÜLLER; straße; STRAẞE; Strasse'],
    ['STRASSE', 'Müller', 'Straße Müller; STRAẞE; STRASSE; straße'],
    ['Σίσυφος', 'Μαρία', 'Σίσυφος Μαρία; ΣΊΣΥΦΟΣ; σίσυφοσ; Σίσυφος'],
  ])('redacts length-changing and Turkish case variants for %s', (firstName, lastName, input) => {
    const context = buildAiSanitizationContext([{ firstName, lastName }])
    const before = structuredClone(context)
    const initials = Object.keys(context.initialsMap)[0]
    expect(sanitizeAiText(input, context)).toBe([initials, initials, initials, initials].join('; '))
    expect(context).toEqual(before)
  })

  it('preserves original non-name text and offsets around length-changing folds', () => {
    const context = buildAiSanitizationContext([{ firstName: 'İpek', lastName: 'Straße' }])
    const input = 'ß ﬃ 🎓 ipek, STRASSE! STRASSE2 ipek_id strasse_extra. Cafe\u0301.'
    expect(sanitizeAiText(input, context)).toBe('ß ﬃ 🎓 İ.S., İ.S.! STRASSE2 ipek_id strasse_extra. Cafe\u0301.')
  })

  it('uses whole Unicode code points for astral initials', () => {
    const context = buildAiSanitizationContext([{ firstName: '\u{10400}na', lastName: '\u{10401}en' }])
    expect(sanitizeAiText('\u{10428}na \u{10429}en; \u{10428}na', context))
      .toBe('\u{10400}.\u{10401}.; \u{10400}.\u{10401}.')
  })

  it('preserves larger Unicode words and identifiers while matching punctuation-delimited names', () => {
    const context = buildAiSanitizationContext([{ firstName: 'Élodie', lastName: 'Gagné' }])
    expect(sanitizeAiText('préÉlodie ÉlodieX Élodie2 Élodie_id Élodie\u203fname (Élodie), «Gagné».', context))
      .toBe('préÉlodie ÉlodieX Élodie2 Élodie_id Élodie\u203fname (É.G.), «É.G.».')
  })

  it('handles compound names and keeps single ASCII initials from replacing prose', () => {
    const context = buildAiSanitizationContext([
      { firstName: 'Anne-Marie', lastName: "O'Neill" },
      { firstName: 'I', lastName: 'Smith' },
    ])
    expect(sanitizeAiText("Anne-Marie and O'Neill: I agree.", context)).toBe('A.O. and A.O.: I agree.')
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
