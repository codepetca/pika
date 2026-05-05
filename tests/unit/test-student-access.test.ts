import { describe, expect, it } from 'vitest'
import { getEffectiveStudentTestAccess } from '@/lib/server/tests'

describe('getEffectiveStudentTestAccess', () => {
  it('keeps draft tests inaccessible even with a student open override', () => {
    expect(getEffectiveStudentTestAccess({
      testStatus: 'draft',
      accessState: 'open',
    })).toMatchObject({
      effective_access: 'closed',
      can_start_or_continue: false,
      can_view_submitted: false,
    })
  })

  it('inherits open access from active tests without an override', () => {
    expect(getEffectiveStudentTestAccess({
      testStatus: 'active',
      accessState: null,
    })).toMatchObject({
      access_source: 'test',
      effective_access: 'open',
      can_start_or_continue: true,
    })
  })

  it('lets a student override close access on an active test', () => {
    expect(getEffectiveStudentTestAccess({
      testStatus: 'active',
      accessState: 'closed',
    })).toMatchObject({
      access_source: 'student',
      effective_access: 'closed',
      can_start_or_continue: false,
    })
  })

  it('lets a student override open access on a closed test', () => {
    expect(getEffectiveStudentTestAccess({
      testStatus: 'closed',
      accessState: 'open',
    })).toMatchObject({
      access_source: 'student',
      effective_access: 'open',
      can_start_or_continue: true,
    })
  })

  it('keeps submitted and returned work viewable but not editable', () => {
    expect(getEffectiveStudentTestAccess({
      testStatus: 'active',
      accessState: 'open',
      hasSubmitted: true,
    })).toMatchObject({
      effective_access: 'open',
      can_start_or_continue: false,
      can_view_submitted: true,
    })

    expect(getEffectiveStudentTestAccess({
      testStatus: 'closed',
      accessState: null,
      returnedAt: '2026-04-01T12:00:00.000Z',
    })).toMatchObject({
      effective_access: 'closed',
      can_start_or_continue: false,
      can_view_submitted: true,
    })
  })
})
