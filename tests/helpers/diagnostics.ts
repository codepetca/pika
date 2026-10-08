import { expect } from 'vitest'

// Synthetic only: exercise common places a database/SDK error can echo content.
export const privateDiagnosticError = {
  code: '23503',
  message: 'PRIVATE_STUDENT_NAME student@example.invalid',
  details: 'PRIVATE_ANSWER grade=42 student-id=private-student',
  hint: 'https://storage.example.invalid/object?token=PRIVATE_TOKEN',
  stack: 'PRIVATE_STACK',
  cause: { response: 'PRIVATE_PROVIDER_BODY' },
}

export function expectContentFreeDiagnostic(
  calls: unknown[][],
  event: string,
  category = 'database',
) {
  // Exact equality rejects extra fields and extra console arguments, not just
  // the sentinel strings. This also proves labels survive the runtime allowlist.
  expect(calls).toEqual([[
    '[pika-diagnostic]',
    {
      event,
      category,
      diagnosticId: expect.stringMatching(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
    },
  ]])
}
