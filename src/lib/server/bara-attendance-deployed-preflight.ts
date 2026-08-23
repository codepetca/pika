import {
  auditBaraAttendanceRolloutEnvironment,
  type BaraAttendanceRolloutAudit,
  type BaraAttendanceRolloutEnvironment,
  type BaraAttendanceRolloutMode,
  type BaraAttendanceRuntimeScopeMode,
} from '@/lib/server/bara-attendance-rollout'

export const PIKA_ATTENDANCE_PRODUCTION_TARGET = Object.freeze({
  stage: 'production' as const,
  expectedSupabaseRef: 'zhioqbapgfcrronyuidm',
  productionSupabaseRef: 'zhioqbapgfcrronyuidm',
  expectedPikaOrigin: 'https://pika.codepet.ca',
  expectedBaraApiOrigin: 'https://adamant-mockingbird-31.convex.site',
})

type DeployedAttendanceEnvironment = BaraAttendanceRolloutEnvironment & {
  VERCEL_ENV?: string
}

export function isDeployedBaraAttendanceEnvironmentReady(
  attendanceMode: BaraAttendanceRolloutMode,
  scopeOrEnvironment: BaraAttendanceRuntimeScopeMode | DeployedAttendanceEnvironment = 'exact_canary',
  maybeEnvironment: DeployedAttendanceEnvironment = process.env as DeployedAttendanceEnvironment,
): boolean {
  return auditDeployedBaraAttendanceEnvironment(
    attendanceMode,
    scopeOrEnvironment,
    maybeEnvironment,
  ).ready
}

export function auditDeployedBaraAttendanceEnvironment(
  attendanceMode: BaraAttendanceRolloutMode,
  scopeOrEnvironment: BaraAttendanceRuntimeScopeMode | DeployedAttendanceEnvironment = 'exact_canary',
  maybeEnvironment: DeployedAttendanceEnvironment = process.env as DeployedAttendanceEnvironment,
): BaraAttendanceRolloutAudit {
  const attendanceScopeMode = typeof scopeOrEnvironment === 'string'
    ? scopeOrEnvironment
    : 'exact_canary'
  const environment = typeof scopeOrEnvironment === 'string'
    ? maybeEnvironment
    : scopeOrEnvironment
  if (environment.VERCEL_ENV !== 'production') {
    return {
      ready: false,
      stage: 'production',
      attendanceMode,
      passedCount: 0,
      checkCount: 1,
      failedChecks: ['deployed_production_runtime'],
    }
  }

  return auditBaraAttendanceRolloutEnvironment(environment, {
    ...PIKA_ATTENDANCE_PRODUCTION_TARGET,
    attendanceMode,
    attendanceScopeMode,
  })
}
