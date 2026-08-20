import type { V1RosterSnapshot } from '@/vendor/attendance-contract/v1/types'
import { validateV1Message } from '@/vendor/attendance-contract/v1/validate'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface BaraAttendanceRosterParticipant {
  participantRef: string
  displayName: string
  active: boolean
  principalRef?: string
}

export interface BuildBaraRosterSnapshotInput {
  installationRef: string
  tenantRef: string
  rosterRef: string
  revision: number
  idempotencyKey: string
  correlationRef: string
  ownerPrincipalRef: string
  ownerDisplayName: string
  displayName: string
  participants: BaraAttendanceRosterParticipant[]
}

function requireOpaqueRef(value: string, prefix?: 'pika' | 'roster' | 'participant' | 'principal') {
  const prefixPattern = prefix ? `${prefix}_` : ''
  const pattern = new RegExp(`^${prefixPattern}[A-Za-z0-9._~-]{1,128}$`)
  if (!pattern.test(value) || UUID.test(value)) {
    throw new Error(`Attendance roster requires an opaque ${prefix ?? 'contract'} reference`)
  }
}

export function buildBaraRosterSnapshot(
  input: BuildBaraRosterSnapshotInput,
): V1RosterSnapshot {
  requireOpaqueRef(input.installationRef, 'pika')
  requireOpaqueRef(input.tenantRef)
  requireOpaqueRef(input.rosterRef, 'roster')
  requireOpaqueRef(input.ownerPrincipalRef, 'principal')

  const participantRefs = new Set<string>()
  const participants = input.participants.map((participant) => {
    requireOpaqueRef(participant.participantRef, 'participant')
    if (participantRefs.has(participant.participantRef)) {
      throw new Error('Attendance participant mappings must be unique')
    }
    participantRefs.add(participant.participantRef)
    if (participant.principalRef) requireOpaqueRef(participant.principalRef, 'principal')
    return {
      participant_ref: participant.participantRef,
      display_name: participant.displayName,
      active: participant.active,
      ...(participant.principalRef
        ? { principal_ref: participant.principalRef }
        : {}),
    }
  })

  const validation = validateV1Message({
    schema_version: 1,
    message_type: 'roster.snapshot',
    idempotency_key: input.idempotencyKey,
    correlation_ref: input.correlationRef,
    installation_ref: input.installationRef,
    roster_ref: input.rosterRef,
    tenant_ref: input.tenantRef,
    revision: input.revision,
    owner_principal_ref: input.ownerPrincipalRef,
    owner_display_name: input.ownerDisplayName,
    display_name: input.displayName,
    participants,
  })
  if (!validation.ok || validation.value.message_type !== 'roster.snapshot') {
    throw new Error('Attendance roster does not satisfy the v1 contract')
  }
  return validation.value
}
