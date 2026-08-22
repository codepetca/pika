import { describe, expect, it } from 'vitest'
import {
  auditBaraAttendanceRolloutEnvironment,
  type BaraAttendanceRolloutEnvironment,
} from '@/lib/server/bara-attendance-rollout'
import {
  PIKA_ATTENDANCE_PRODUCTION_TARGET,
  auditDeployedBaraAttendanceEnvironment,
  isDeployedBaraAttendanceEnvironmentReady,
} from '@/lib/server/bara-attendance-deployed-preflight'

const previewRef = 'abcdefghijklmnopqrst'
const productionRef = 'zyxwvutsrqponmlkjihg'
const sessionSecret = 'session-secret-that-is-definitely-long-enough'
const cookiePassword = 'workos-cookie-password-that-is-long-enough'
const integrationSecret = 'integration-secret-that-is-long-enough'
const eventSecret = 'event-secret-that-is-long-enough-and-distinct'
const entryTokenSecret = 'entry-token-secret-that-is-long-enough'
const smokeOperatorSecret = 'smoke-operator-secret-that-is-long-enough'

function readyEnvironment(): BaraAttendanceRolloutEnvironment {
  return {
    NEXT_PUBLIC_SUPABASE_URL: `https://${previewRef}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_preview',
    SUPABASE_SECRET_KEY: 'sb_secret_preview',
    SESSION_SECRET: sessionSecret,
    NEXT_PUBLIC_APP_URL: 'https://pika-preview.example',
    WORKOS_MAGIC_AUTH_PILOT: 'true',
    WORKOS_CLIENT_ID: 'client_preview',
    WORKOS_API_KEY: 'sk_test_preview',
    WORKOS_COOKIE_PASSWORD: cookiePassword,
    WORKOS_COOKIE_NAME: 'pika-wos-session',
    WORKOS_COOKIE_MAX_AGE: '15552000',
    WORKOS_MAGIC_AUTH_EMAIL_DELIVERY: 'brevo',
    WORKOS_MAGIC_AUTH_DEFAULT_EMAILS_DISABLED: 'true',
    ENABLE_MOCK_EMAIL: 'false',
    BREVO_API_KEY: 'brevo-preview-secret',
    BREVO_TEMPLATE_ID: '2',
    BREVO_FROM_EMAIL: 'noreply@notify.codepet.ca',
    BREVO_FROM_NAME: 'Pika',
    PIKA_BARA_AUTH_HANDOFF: 'false',
    PIKA_BARA_ATTENDANCE_ENABLED: 'true',
    PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID: '10000000-0000-4000-8000-000000000001',
    PIKA_BARA_ATTENDANCE_CANARY_CLASSROOM_ID: '20000000-0000-4000-8000-000000000002',
    BARA_ATTENDANCE_API_BASE_URL: 'https://bara-api-preview.example',
    BARA_ATTENDANCE_INSTALLATION_REF: 'pika_preview',
    BARA_ATTENDANCE_TENANT_REF: 'tenant_preview',
    BARA_ATTENDANCE_INTEGRATION_SECRET: integrationSecret,
    BARA_ATTENDANCE_EVENT_SECRET: eventSecret,
    BARA_ATTENDANCE_ENTRY_TOKEN_SECRET: entryTokenSecret,
    BARA_ATTENDANCE_SMOKE_OPERATOR_SECRET: smokeOperatorSecret,
    CRON_SECRET: 'cron-secret-that-is-definitely-long-enough',
  }
}

const target = {
  stage: 'preview' as const,
  attendanceMode: 'enabled' as const,
  expectedSupabaseRef: previewRef,
  productionSupabaseRef: productionRef,
  expectedPikaOrigin: 'https://pika-preview.example',
  expectedBaraApiOrigin: 'https://bara-api-preview.example',
}

describe('Bara attendance rollout environment audit', () => {
  it('accepts an isolated preview environment with the complete one-login contract', () => {
    const result = auditBaraAttendanceRolloutEnvironment(readyEnvironment(), target)

    expect(result).toEqual({
      ready: true,
      stage: 'preview',
      attendanceMode: 'enabled',
      passedCount: result.checkCount,
      checkCount: result.checkCount,
      failedChecks: [],
    })
    expect(result.checkCount).toBeGreaterThanOrEqual(16)
  })

  it('can prove complete configuration while runtime attendance remains disabled', () => {
    const environment = readyEnvironment()
    environment.PIKA_BARA_ATTENDANCE_ENABLED = 'false'

    const result = auditBaraAttendanceRolloutEnvironment(environment, {
      ...target,
      attendanceMode: 'pre-enable',
    })

    expect(result.ready).toBe(true)
    expect(result.failedChecks).toEqual([])
  })

  it('does not confuse pre-enable and enabled rollout modes', () => {
    const environment = readyEnvironment()
    expect(auditBaraAttendanceRolloutEnvironment(environment, {
      ...target,
      attendanceMode: 'pre-enable',
    }).failedChecks).toContain('attendance_disabled_for_preflight')

    environment.PIKA_BARA_ATTENDANCE_ENABLED = 'false'
    expect(auditBaraAttendanceRolloutEnvironment(environment, target).failedChecks)
      .toContain('attendance_enabled')
  })

  it('requires the smoke operator credential to be distinct from shared cron auth', () => {
    const environment = readyEnvironment()
    environment.BARA_ATTENDANCE_SMOKE_OPERATOR_SECRET = environment.CRON_SECRET

    expect(auditBaraAttendanceRolloutEnvironment(environment, target).failedChecks)
      .toContain('distinct_integration_secrets')
  })

  it('fails closed when preview shares production or uses incomplete provider configuration', () => {
    const environment = readyEnvironment()
    environment.NEXT_PUBLIC_SUPABASE_URL = `https://${productionRef}.supabase.co`
    environment.WORKOS_API_KEY = 'sk_live_wrong_environment'
    environment.WORKOS_MAGIC_AUTH_DEFAULT_EMAILS_DISABLED = 'false'
    environment.BARA_ATTENDANCE_EVENT_SECRET = integrationSecret

    const result = auditBaraAttendanceRolloutEnvironment(environment, {
      ...target,
      expectedSupabaseRef: productionRef,
    })

    expect(result.ready).toBe(false)
    expect(result.failedChecks).toEqual(expect.arrayContaining([
      'isolated_supabase_target',
      'workos_staging_credentials',
      'brevo_magic_auth_delivery',
      'distinct_integration_secrets',
    ]))
  })

  it('never includes configured credentials or origins in its result', () => {
    const environment = readyEnvironment()
    environment.BARA_ATTENDANCE_INTEGRATION_SECRET = 'too-short'

    const serialized = JSON.stringify(
      auditBaraAttendanceRolloutEnvironment(environment, target),
    )

    for (const value of [
      environment.SESSION_SECRET,
      environment.WORKOS_API_KEY,
      environment.WORKOS_COOKIE_PASSWORD,
      environment.BREVO_API_KEY,
      environment.BARA_ATTENDANCE_API_BASE_URL,
      environment.BARA_ATTENDANCE_INTEGRATION_SECRET,
      environment.BARA_ATTENDANCE_EVENT_SECRET,
      environment.BARA_ATTENDANCE_ENTRY_TOKEN_SECRET,
      environment.BARA_ATTENDANCE_SMOKE_OPERATOR_SECRET,
      environment.CRON_SECRET,
    ]) if (value) expect(serialized).not.toContain(value)
    expect(serialized).toContain('bara_attendance_transport')
  })
})

describe('deployed Bara attendance preflight', () => {
  function readyProductionEnvironment(): BaraAttendanceRolloutEnvironment & {
    VERCEL_ENV: string
  } {
    return {
      ...readyEnvironment(),
      VERCEL_ENV: 'production',
      NEXT_PUBLIC_SUPABASE_URL: 'https://zhioqbapgfcrronyuidm.supabase.co',
      NEXT_PUBLIC_APP_URL: 'https://pika.codepet.ca',
      WORKOS_API_KEY: 'sk_live_production',
      PIKA_BARA_ATTENDANCE_ENABLED: 'false',
      BARA_ATTENDANCE_API_BASE_URL: 'https://adamant-mockingbird-31.convex.site',
    }
  }

  it('pins the exact reviewed production targets', () => {
    expect(PIKA_ATTENDANCE_PRODUCTION_TARGET).toEqual({
      stage: 'production',
      expectedSupabaseRef: 'zhioqbapgfcrronyuidm',
      productionSupabaseRef: 'zhioqbapgfcrronyuidm',
      expectedPikaOrigin: 'https://pika.codepet.ca',
      expectedBaraApiOrigin: 'https://adamant-mockingbird-31.convex.site',
    })
  })

  it('accepts the deployed production environment only in the requested flag mode', () => {
    const environment = readyProductionEnvironment()

    expect(isDeployedBaraAttendanceEnvironmentReady('pre-enable', environment)).toBe(true)
    expect(isDeployedBaraAttendanceEnvironmentReady('enabled', environment)).toBe(false)

    environment.PIKA_BARA_ATTENDANCE_ENABLED = 'true'
    expect(isDeployedBaraAttendanceEnvironmentReady('pre-enable', environment)).toBe(false)
    expect(isDeployedBaraAttendanceEnvironmentReady('enabled', environment)).toBe(true)
  })

  it('fails closed outside production or when a pinned origin drifts', () => {
    const environment = readyProductionEnvironment()
    environment.VERCEL_ENV = 'preview'
    expect(isDeployedBaraAttendanceEnvironmentReady('pre-enable', environment)).toBe(false)
    expect(auditDeployedBaraAttendanceEnvironment('pre-enable', environment)).toEqual({
      ready: false,
      stage: 'production',
      attendanceMode: 'pre-enable',
      passedCount: 0,
      checkCount: 1,
      failedChecks: ['deployed_production_runtime'],
    })

    environment.VERCEL_ENV = 'production'
    environment.BARA_ATTENDANCE_API_BASE_URL = 'https://other.convex.site'
    expect(isDeployedBaraAttendanceEnvironmentReady('pre-enable', environment)).toBe(false)
  })
})
