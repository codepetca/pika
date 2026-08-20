import { describe, expect, it } from 'vitest'

import { buildBaraRosterSnapshot } from '@/lib/server/bara-attendance-roster'

function input() {
  return {
    installationRef: 'pika_staging',
    tenantRef: 'tenant_staging',
    rosterRef: 'roster_11111111111111111111111111111111',
    revision: 3,
    idempotencyKey: 'roster:roster_11111111111111111111111111111111:3',
    correlationRef: 'correlation_roster_3',
    ownerPrincipalRef: 'principal_teacher',
    ownerDisplayName: 'Teacher One',
    displayName: '  Period 2 Science  ',
    participants: [
      {
        participantRef: 'participant_22222222222222222222222222222222',
        displayName: '  Alex Morgan  ',
        active: true,
        principalRef: 'principal_student',
      },
      {
        participantRef: 'participant_33333333333333333333333333333333',
        displayName: 'Sam Lee',
        active: true,
      },
    ],
  }
}

describe('Bara attendance roster materialization', () => {
  it('builds the minimal standalone roster without Pika IDs or emails', () => {
    const snapshot = buildBaraRosterSnapshot(input())

    expect(snapshot).toEqual({
      schema_version: 1,
      message_type: 'roster.snapshot',
      idempotency_key: 'roster:roster_11111111111111111111111111111111:3',
      correlation_ref: 'correlation_roster_3',
      installation_ref: 'pika_staging',
      roster_ref: 'roster_11111111111111111111111111111111',
      tenant_ref: 'tenant_staging',
      revision: 3,
      owner_principal_ref: 'principal_teacher',
      owner_display_name: 'Teacher One',
      display_name: 'Period 2 Science',
      participants: [
        {
          participant_ref: 'participant_22222222222222222222222222222222',
          display_name: 'Alex Morgan',
          active: true,
          principal_ref: 'principal_student',
        },
        {
          participant_ref: 'participant_33333333333333333333333333333333',
          display_name: 'Sam Lee',
          active: true,
        },
      ],
    })
    expect(JSON.stringify(snapshot)).not.toContain('@')
    expect(JSON.stringify(snapshot)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    )
  })

  it('rejects duplicate participant mappings', () => {
    const duplicate = input()
    duplicate.participants[1].participantRef = duplicate.participants[0].participantRef
    expect(() => buildBaraRosterSnapshot(duplicate)).toThrow(
      'Attendance participant mappings must be unique',
    )
  })

  it('rejects raw application IDs and email-shaped identity subjects', () => {
    expect(() => buildBaraRosterSnapshot({
      ...input(),
      rosterRef: '20000000-0000-4000-8000-000000000002',
    })).toThrow('opaque roster reference')
    expect(() => buildBaraRosterSnapshot({
      ...input(),
      ownerPrincipalRef: 'teacher@example.com',
    })).toThrow('opaque principal reference')
  })
})
