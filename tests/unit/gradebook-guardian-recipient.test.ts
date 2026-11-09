import { describe, expect, it } from 'vitest'
import { getGuardianRecipient } from '@/lib/gradebook-email'

describe('guardian recipient matching', () => {
  it('uses the one roster entry linked to the student', () => {
    expect(getGuardianRecipient([
      { student_id: 'other', counselor_email: 'other@example.com' },
      { student_id: 'student', counselor_email: ' parent@example.com ' },
    ], 'student')).toEqual({ email: 'parent@example.com', status: 'Review address' })
  })

  it('never guesses when the binding or address needs attention', () => {
    expect(getGuardianRecipient([], 'student').status).toBe('Roster match unavailable')
    expect(getGuardianRecipient([{ student_id: null, counselor_email: 'parent@example.com' }], 'student').email).toBe('')
    expect(getGuardianRecipient([{ student_id: 'student', counselor_email: null }], 'student').status).toBe('Missing guardian email')
    expect(getGuardianRecipient([{ student_id: 'student', counselor_email: 'a@example.com, b@example.com' }], 'student').status).toBe('Invalid guardian email')
    expect(getGuardianRecipient([{ student_id: 'student', counselor_email: 'a@example.com' }, { student_id: 'student', counselor_email: 'b@example.com' }], 'student').status).toBe('Multiple roster entries')
  })
})
