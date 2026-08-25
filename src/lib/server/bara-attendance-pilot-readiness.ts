import { z } from 'zod'

const entitlementSchema = z.object({
  status: z.enum(['active', 'revoked']),
  valid_from: z.string().datetime({ offset: true }),
  valid_until: z.string().datetime({ offset: true }).nullable(),
  revision: z.number().int().positive(),
}).strict()

const classroomSchema = z.object({ id: z.string().uuid() }).strict()
const policySchema = z.object({
  classroom_id: z.string().uuid(),
  enabled: z.boolean(),
}).strict()
const mappingSchema = z.object({
  classroom_id: z.string().uuid(),
  integration_state: z.enum(['active', 'deactivating', 'inactive']),
  roster_ref: z.string().regex(/^roster_[A-Za-z0-9_-]{32,128}$/),
  source_revision: z.number().int().nonnegative(),
  synced_revision: z.number().int().nonnegative().nullable(),
  schedule_source_revision: z.number().int().nonnegative(),
  schedule_synced_revision: z.number().int().nonnegative().nullable(),
}).strict()

export type BaraAttendancePilotReadinessBlocker =
  | 'teacher_entitlement_not_effective'
  | 'requires_at_least_two_active_classrooms'
  | 'requires_configured_active_classroom'
  | 'requires_unconfigured_active_classroom'
  | 'configured_classroom_not_fully_synced'

export interface BaraAttendancePilotReadiness {
  readyForScopedSaveVerification: boolean
  entitlementRevision: number | null
  activeClassrooms: number
  configuredClassrooms: number
  enabledPolicies: number
  unconfiguredClassrooms: number
  rosterMappings: number
  activeMappings: number
  fullySyncedMappings: number
  blockers: BaraAttendancePilotReadinessBlocker[]
}

interface BaraAttendancePilotRows {
  entitlement: unknown
  classrooms: unknown[]
  policies: unknown[]
  mappings: unknown[]
  at: Date
}

export function summarizeBaraAttendancePilotReadiness(
  input: BaraAttendancePilotRows,
): BaraAttendancePilotReadiness {
  const entitlement = input.entitlement === null
    ? null
    : entitlementSchema.parse(input.entitlement)
  const classrooms = z.array(classroomSchema).parse(input.classrooms)
  const policies = z.array(policySchema).parse(input.policies)
  const mappings = z.array(mappingSchema).parse(input.mappings)
  const classroomIds = new Set(classrooms.map((classroom) => classroom.id))
  const scopedPolicies = policies.filter((policy) => classroomIds.has(policy.classroom_id))
  const scopedMappings = mappings.filter((mapping) => classroomIds.has(mapping.classroom_id))
  const configuredClassroomIds = new Set(scopedPolicies.map((policy) => policy.classroom_id))
  const effectiveEntitlement = entitlement !== null
    && entitlement.status === 'active'
    && Date.parse(entitlement.valid_from) <= input.at.getTime()
    && (entitlement.valid_until === null
      || Date.parse(entitlement.valid_until) > input.at.getTime())
  const fullySyncedMappings = scopedMappings.filter((mapping) => (
    mapping.integration_state === 'active'
    && mapping.synced_revision !== null
    && mapping.synced_revision >= mapping.source_revision
    && mapping.schedule_synced_revision !== null
    && mapping.schedule_synced_revision >= mapping.schedule_source_revision
  )).length
  const blockers: BaraAttendancePilotReadinessBlocker[] = []

  if (!effectiveEntitlement) blockers.push('teacher_entitlement_not_effective')
  if (classrooms.length < 2) blockers.push('requires_at_least_two_active_classrooms')
  if (configuredClassroomIds.size === 0) blockers.push('requires_configured_active_classroom')
  if (configuredClassroomIds.size === classrooms.length) {
    blockers.push('requires_unconfigured_active_classroom')
  }
  if (configuredClassroomIds.size > 0 && fullySyncedMappings < configuredClassroomIds.size) {
    blockers.push('configured_classroom_not_fully_synced')
  }

  return {
    readyForScopedSaveVerification: blockers.length === 0,
    entitlementRevision: effectiveEntitlement ? entitlement.revision : null,
    activeClassrooms: classrooms.length,
    configuredClassrooms: configuredClassroomIds.size,
    enabledPolicies: scopedPolicies.filter((policy) => policy.enabled).length,
    unconfiguredClassrooms: classrooms.length - configuredClassroomIds.size,
    rosterMappings: scopedMappings.length,
    activeMappings: scopedMappings.filter((mapping) => mapping.integration_state === 'active').length,
    fullySyncedMappings,
    blockers,
  }
}

export async function readBaraAttendancePilotReadiness(input: {
  supabase: any
  teacherId: string
  at?: Date
}): Promise<BaraAttendancePilotReadiness> {
  const at = input.at ?? new Date()
  const { data: entitlement, error: entitlementError } = await input.supabase
    .from('attendance_teacher_entitlements')
    .select('status,valid_from,valid_until,revision')
    .eq('teacher_id', input.teacherId)
    .maybeSingle()
  if (entitlementError) throw new Error('Attendance pilot entitlement could not be read')

  const { data: classrooms, error: classroomError } = await input.supabase
    .from('classrooms')
    .select('id')
    .eq('teacher_id', input.teacherId)
    .is('archived_at', null)
  if (classroomError) throw new Error('Attendance pilot classrooms could not be read')

  const classroomIds = (classrooms ?? []).map((classroom: { id: string }) => classroom.id)
  if (classroomIds.length === 0) {
    return summarizeBaraAttendancePilotReadiness({
      entitlement,
      classrooms: [],
      policies: [],
      mappings: [],
      at,
    })
  }

  const [{ data: policies, error: policyError }, { data: mappings, error: mappingError }] =
    await Promise.all([
      input.supabase
        .from('attendance_window_policies')
        .select('classroom_id,enabled')
        .in('classroom_id', classroomIds),
      input.supabase
        .from('attendance_roster_mappings')
        .select(
          'classroom_id,integration_state,roster_ref,source_revision,synced_revision,' +
          'schedule_source_revision,schedule_synced_revision',
        )
        .in('classroom_id', classroomIds),
    ])
  if (policyError) throw new Error('Attendance pilot policies could not be read')
  if (mappingError) throw new Error('Attendance pilot mappings could not be read')

  return summarizeBaraAttendancePilotReadiness({
    entitlement,
    classrooms: classrooms ?? [],
    policies: policies ?? [],
    mappings: mappings ?? [],
    at,
  })
}
