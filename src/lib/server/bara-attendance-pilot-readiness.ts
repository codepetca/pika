import { z } from 'zod'

import { createTargetBoundFetch } from '@/lib/server/supabase-target'

const aggregateSchema = z.object({
  effective_entitlement_count: z.number().int().min(0).max(1),
  active_classrooms: z.number().int().nonnegative(),
  configured_classrooms: z.number().int().nonnegative(),
  enabled_policies: z.number().int().nonnegative(),
  unconfigured_classrooms: z.number().int().nonnegative(),
  roster_mappings: z.number().int().nonnegative(),
  active_mappings: z.number().int().nonnegative(),
  fully_synced_configured_classrooms: z.number().int().nonnegative(),
}).strict()

const readRequestSchema = z.object({
  p_teacher_id: z.string().uuid(),
  p_at: z.string().datetime({ offset: true }),
}).strict()

export type BaraAttendancePilotReadinessBlocker =
  | 'teacher_entitlement_not_effective'
  | 'requires_at_least_two_active_classrooms'
  | 'requires_configured_active_classroom'
  | 'requires_unconfigured_active_classroom'
  | 'configured_classroom_not_fully_synced'

export interface BaraAttendancePilotReadiness {
  readyForScopedSaveVerification: boolean
  effectiveEntitlements: number
  activeClassrooms: number
  configuredClassrooms: number
  enabledPolicies: number
  unconfiguredClassrooms: number
  rosterMappings: number
  activeMappings: number
  fullySyncedConfiguredClassrooms: number
  blockers: BaraAttendancePilotReadinessBlocker[]
}

export function summarizeBaraAttendancePilotReadiness(
  value: unknown,
): BaraAttendancePilotReadiness {
  const aggregate = aggregateSchema.parse(value)
  const blockers: BaraAttendancePilotReadinessBlocker[] = []

  if (aggregate.effective_entitlement_count !== 1) {
    blockers.push('teacher_entitlement_not_effective')
  }
  if (aggregate.active_classrooms < 2) {
    blockers.push('requires_at_least_two_active_classrooms')
  }
  if (aggregate.configured_classrooms === 0) {
    blockers.push('requires_configured_active_classroom')
  }
  if (aggregate.unconfigured_classrooms === 0) {
    blockers.push('requires_unconfigured_active_classroom')
  }
  if (
    aggregate.configured_classrooms > 0
    && aggregate.fully_synced_configured_classrooms < aggregate.configured_classrooms
  ) {
    blockers.push('configured_classroom_not_fully_synced')
  }

  return {
    readyForScopedSaveVerification: blockers.length === 0,
    effectiveEntitlements: aggregate.effective_entitlement_count,
    activeClassrooms: aggregate.active_classrooms,
    configuredClassrooms: aggregate.configured_classrooms,
    enabledPolicies: aggregate.enabled_policies,
    unconfiguredClassrooms: aggregate.unconfigured_classrooms,
    rosterMappings: aggregate.roster_mappings,
    activeMappings: aggregate.active_mappings,
    fullySyncedConfiguredClassrooms: aggregate.fully_synced_configured_classrooms,
    blockers,
  }
}

export async function readBaraAttendancePilotReadiness(input: {
  supabase: any
  teacherId: string
  at?: Date
}): Promise<BaraAttendancePilotReadiness> {
  const { data, error } = await input.supabase.rpc('get_attendance_pilot_readiness_v1', {
    p_teacher_id: input.teacherId,
    p_at: (input.at ?? new Date()).toISOString(),
  })
  if (error) throw new Error('Attendance pilot readiness could not be read')
  return summarizeBaraAttendancePilotReadiness(data)
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input)
  if (input instanceof URL) return input
  return new URL(input.url)
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  if (typeof init?.body === 'string') return JSON.parse(init.body)
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return await input.clone().json()
  }
  throw new Error('Attendance pilot read transport rejected request')
}

export function createAttendancePilotReadOnlyFetch(input: {
  expectedOrigin: string
  teacherId: string
  fetchImpl?: typeof fetch
}): typeof fetch {
  const targetFetch = createTargetBoundFetch(input.expectedOrigin, input.fetchImpl)
  return async (request, init) => {
    const url = requestUrl(request)
    const method = (init?.method
      ?? (typeof Request !== 'undefined' && request instanceof Request ? request.method : 'GET'))
      .toUpperCase()
    if (
      method !== 'POST'
      || url.pathname !== '/rest/v1/rpc/get_attendance_pilot_readiness_v1'
      || url.search !== ''
    ) {
      throw new Error('Attendance pilot read transport rejected request')
    }
    const body = readRequestSchema.parse(await requestBody(request, init))
    if (body.p_teacher_id !== input.teacherId) {
      throw new Error('Attendance pilot read transport rejected request')
    }
    return await targetFetch(request, init)
  }
}
