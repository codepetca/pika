type AuthenticationEnvironment = Record<string, string | undefined>

export function isLegacyPasswordAuthEnabled(
  environment: AuthenticationEnvironment = process.env as AuthenticationEnvironment,
): boolean {
  return environment.PIKA_LEGACY_PASSWORD_AUTH === 'true'
}

export function isWorkOSMagicAuthEnabled(
  environment: AuthenticationEnvironment = process.env as AuthenticationEnvironment,
): boolean {
  return !isLegacyPasswordAuthEnabled(environment)
}

export function isWorkOSAuthKitConfigured(
  environment: AuthenticationEnvironment = process.env as AuthenticationEnvironment,
): boolean {
  return (
    environment.WORKOS_CLIENT_ID?.trim().startsWith('client_') === true
    && environment.WORKOS_API_KEY?.trim().startsWith('sk_') === true
    && (environment.WORKOS_COOKIE_PASSWORD?.length ?? 0) >= 32
    && (environment.SESSION_SECRET?.length ?? 0) >= 32
  )
}

export function shouldUseWorkOSAuthKit(
  environment: AuthenticationEnvironment = process.env as AuthenticationEnvironment,
): boolean {
  return isWorkOSMagicAuthEnabled(environment) && isWorkOSAuthKitConfigured(environment)
}
