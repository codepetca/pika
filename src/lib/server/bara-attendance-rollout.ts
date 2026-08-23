export type BaraAttendanceRolloutStage = 'preview' | 'production'
export type BaraAttendanceRolloutMode = 'pre-enable' | 'enabled'
export type BaraAttendanceRuntimeScopeMode = 'exact_canary' | 'teacher_entitlements'

export interface BaraAttendanceRolloutEnvironment {
  NEXT_PUBLIC_SUPABASE_URL?: string
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string
  SUPABASE_SECRET_KEY?: string
  SESSION_SECRET?: string
  NEXT_PUBLIC_APP_URL?: string
  WORKOS_MAGIC_AUTH_PILOT?: string
  WORKOS_CLIENT_ID?: string
  WORKOS_API_KEY?: string
  WORKOS_COOKIE_PASSWORD?: string
  WORKOS_COOKIE_NAME?: string
  WORKOS_COOKIE_MAX_AGE?: string
  WORKOS_MAGIC_AUTH_EMAIL_DELIVERY?: string
  WORKOS_MAGIC_AUTH_DEFAULT_EMAILS_DISABLED?: string
  ENABLE_MOCK_EMAIL?: string
  BREVO_API_KEY?: string
  BREVO_TEMPLATE_ID?: string
  BREVO_FROM_EMAIL?: string
  BREVO_FROM_NAME?: string
  PIKA_BARA_AUTH_HANDOFF?: string
  PIKA_BARA_ATTENDANCE_ENABLED?: string
  PIKA_BARA_ATTENDANCE_SCOPE_MODE?: string
  PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID?: string
  PIKA_BARA_ATTENDANCE_CANARY_CLASSROOM_ID?: string
  BARA_ATTENDANCE_API_BASE_URL?: string
  BARA_ATTENDANCE_INSTALLATION_REF?: string
  BARA_ATTENDANCE_TENANT_REF?: string
  BARA_ATTENDANCE_INTEGRATION_SECRET?: string
  BARA_ATTENDANCE_EVENT_SECRET?: string
  BARA_ATTENDANCE_ENTRY_TOKEN_SECRET?: string
  BARA_ATTENDANCE_SMOKE_OPERATOR_SECRET?: string
  CRON_SECRET?: string
}

export interface BaraAttendanceRolloutTarget {
  stage: BaraAttendanceRolloutStage
  attendanceMode: BaraAttendanceRolloutMode
  attendanceScopeMode: BaraAttendanceRuntimeScopeMode
  expectedSupabaseRef: string
  productionSupabaseRef: string
  expectedPikaOrigin: string
  expectedBaraApiOrigin: string
}

export interface BaraAttendanceRolloutAudit {
  ready: boolean
  stage: BaraAttendanceRolloutStage
  attendanceMode: BaraAttendanceRolloutMode
  passedCount: number
  checkCount: number
  failedChecks: string[]
}

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/
const INSTALLATION_REF_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function trimmed(value: string | undefined): string {
  return value?.trim() ?? ''
}

function exactHttpsOrigin(value: string | undefined, expected: string): boolean {
  try {
    const actualUrl = new URL(trimmed(value))
    const expectedUrl = new URL(expected)
    return (
      actualUrl.protocol === 'https:'
      && expectedUrl.protocol === 'https:'
      && actualUrl.origin === expectedUrl.origin
      && actualUrl.username === ''
      && actualUrl.password === ''
      && actualUrl.pathname === '/'
      && actualUrl.search === ''
      && actualUrl.hash === ''
      && expectedUrl.username === ''
      && expectedUrl.password === ''
      && expectedUrl.pathname === '/'
      && expectedUrl.search === ''
      && expectedUrl.hash === ''
    )
  } catch {
    return false
  }
}

function hasSecret(value: string | undefined, minimumLength = 32): boolean {
  return (value ?? '').length >= minimumLength
}

function allDistinct(values: Array<string | undefined>): boolean {
  const normalized = values.map((value) => value ?? '')
  return normalized.every(Boolean) && new Set(normalized).size === normalized.length
}

export function auditBaraAttendanceRolloutEnvironment(
  environment: BaraAttendanceRolloutEnvironment,
  target: BaraAttendanceRolloutTarget,
): BaraAttendanceRolloutAudit {
  const expectedRefValid = PROJECT_REF_PATTERN.test(target.expectedSupabaseRef)
  const productionRefValid = PROJECT_REF_PATTERN.test(target.productionSupabaseRef)
  const expectedSupabaseOrigin = expectedRefValid
    ? `https://${target.expectedSupabaseRef}.supabase.co`
    : ''
  const workosApiKey = trimmed(environment.WORKOS_API_KEY)
  const isExpectedWorkOSEnvironment = target.stage === 'preview'
    ? workosApiKey.startsWith('sk_test_')
    : workosApiKey.startsWith('sk_') && !workosApiKey.startsWith('sk_test_')

  const checks: Array<[string, boolean]> = [
    ['valid_target_refs', expectedRefValid && productionRefValid],
    [
      'isolated_supabase_target',
      expectedRefValid
        && productionRefValid
        && (target.stage === 'preview'
          ? target.expectedSupabaseRef !== target.productionSupabaseRef
          : target.expectedSupabaseRef === target.productionSupabaseRef),
    ],
    [
      'supabase_api_origin',
      Boolean(expectedSupabaseOrigin)
        && exactHttpsOrigin(environment.NEXT_PUBLIC_SUPABASE_URL, expectedSupabaseOrigin),
    ],
    [
      'supabase_credentials',
      trimmed(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).length >= 16
        && trimmed(environment.SUPABASE_SECRET_KEY).length >= 16,
    ],
    ['pika_origin', exactHttpsOrigin(environment.NEXT_PUBLIC_APP_URL, target.expectedPikaOrigin)],
    ['session_secret', hasSecret(environment.SESSION_SECRET)],
    ['workos_pilot_enabled', environment.WORKOS_MAGIC_AUTH_PILOT === 'true'],
    [
      target.stage === 'preview'
        ? 'workos_staging_credentials'
        : 'workos_production_credentials',
      trimmed(environment.WORKOS_CLIENT_ID).startsWith('client_')
        && isExpectedWorkOSEnvironment,
    ],
    [
      'workos_cookie',
      hasSecret(environment.WORKOS_COOKIE_PASSWORD)
        && environment.WORKOS_COOKIE_PASSWORD !== environment.SESSION_SECRET
        && trimmed(environment.WORKOS_COOKIE_NAME) === 'pika-wos-session'
        && trimmed(environment.WORKOS_COOKIE_MAX_AGE) === '15552000',
    ],
    [
      'brevo_magic_auth_delivery',
      trimmed(environment.WORKOS_MAGIC_AUTH_EMAIL_DELIVERY).toLowerCase() === 'brevo'
        && environment.WORKOS_MAGIC_AUTH_DEFAULT_EMAILS_DISABLED === 'true',
    ],
    [
      'brevo_credentials',
      trimmed(environment.BREVO_API_KEY).length >= 16
        && /^[1-9][0-9]*$/.test(trimmed(environment.BREVO_TEMPLATE_ID))
        && EMAIL_PATTERN.test(trimmed(environment.BREVO_FROM_EMAIL))
        && trimmed(environment.BREVO_FROM_NAME).length > 0,
    ],
    ['mock_email_disabled', environment.ENABLE_MOCK_EMAIL === 'false'],
    ['legacy_browser_handoff_disabled', environment.PIKA_BARA_AUTH_HANDOFF !== 'true'],
    [
      target.attendanceMode === 'enabled'
        ? 'attendance_enabled'
        : 'attendance_disabled_for_preflight',
      environment.PIKA_BARA_ATTENDANCE_ENABLED
        === (target.attendanceMode === 'enabled' ? 'true' : 'false'),
    ],
    [
      'attendance_exact_canary',
      UUID_PATTERN.test(trimmed(environment.PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID))
        && UUID_PATTERN.test(trimmed(environment.PIKA_BARA_ATTENDANCE_CANARY_CLASSROOM_ID)),
    ],
    [
      'attendance_scope_mode',
      (trimmed(environment.PIKA_BARA_ATTENDANCE_SCOPE_MODE) || 'exact_canary')
        === target.attendanceScopeMode,
    ],
    [
      'bara_attendance_origin',
      exactHttpsOrigin(environment.BARA_ATTENDANCE_API_BASE_URL, target.expectedBaraApiOrigin),
    ],
    [
      'bara_attendance_transport',
      INSTALLATION_REF_PATTERN.test(trimmed(environment.BARA_ATTENDANCE_INSTALLATION_REF))
        && INSTALLATION_REF_PATTERN.test(trimmed(environment.BARA_ATTENDANCE_TENANT_REF))
        && hasSecret(environment.BARA_ATTENDANCE_INTEGRATION_SECRET),
    ],
    ['bara_event_ingress', hasSecret(environment.BARA_ATTENDANCE_EVENT_SECRET)],
    ['attendance_entry_tokens', hasSecret(environment.BARA_ATTENDANCE_ENTRY_TOKEN_SECRET)],
    ['attendance_smoke_operator', hasSecret(environment.BARA_ATTENDANCE_SMOKE_OPERATOR_SECRET)],
    [
      'distinct_integration_secrets',
      allDistinct([
        environment.SESSION_SECRET,
        environment.WORKOS_COOKIE_PASSWORD,
        environment.BARA_ATTENDANCE_INTEGRATION_SECRET,
        environment.BARA_ATTENDANCE_EVENT_SECRET,
        environment.BARA_ATTENDANCE_ENTRY_TOKEN_SECRET,
        environment.BARA_ATTENDANCE_SMOKE_OPERATOR_SECRET,
        environment.CRON_SECRET,
      ]),
    ],
    ['cron_secret', hasSecret(environment.CRON_SECRET)],
  ]

  const failedChecks = checks
    .filter(([, passed]) => !passed)
    .map(([name]) => name)

  return {
    ready: failedChecks.length === 0,
    stage: target.stage,
    attendanceMode: target.attendanceMode,
    passedCount: checks.length - failedChecks.length,
    checkCount: checks.length,
    failedChecks,
  }
}
