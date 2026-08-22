import { randomBytes } from 'node:crypto'
import { chmodSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AUTH_SESSION_MAX_AGE_SECONDS } from '../src/lib/auth-session-policy'

const PIKA_ORIGIN = 'http://localhost:3000'
const BARA_ORIGIN = 'http://localhost:3001'
const EVENT_PATH = '/api/integrations/attendance/v1/events'
const SECRET_LENGTH = 32

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]?.trim()
  return value || undefined
}

function hasArgument(name: string): boolean {
  return process.argv.includes(name)
}

function parseEnvironment(contents: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }
    result[match[1]] = value
  }
  return result
}

function upsertEnvironment(contents: string, updates: Record<string, string>): string {
  const remaining = new Map(Object.entries(updates))
  const lines = contents.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)
    if (!match || !remaining.has(match[1])) return line
    const value = remaining.get(match[1])!
    remaining.delete(match[1])
    return `${match[1]}=${value}`
  })
  while (lines.at(-1) === '') lines.pop()
  if (remaining.size > 0) {
    lines.push('', '# Local Pika ↔ Bara attendance integration')
    for (const [name, value] of remaining) lines.push(`${name}=${value}`)
  }
  return `${lines.join('\n')}\n`
}

function secureValue(...candidates: Array<string | undefined>): string {
  const existing = candidates.find((value) => (value ?? '').length >= SECRET_LENGTH)
  return existing ?? randomBytes(32).toString('base64url')
}

function validOrigin(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? '')
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) return null
    return url.origin
  } catch {
    return null
  }
}

async function main() {
const pikaEnvPath = realpathSync(resolve(argument('--pika-env') ?? '.env.local'))
const baraEnvPath = realpathSync(resolve(
  argument('--bara-env') ?? '/Users/stew/Repos/bara/.env.local',
))
const brevoEnvPath = realpathSync(resolve(
  argument('--brevo-env') ?? '/Users/stew/Repos/pika/.env.staging',
))
const eventDeliveryUrl = argument('--event-delivery-url')
  ?? `${PIKA_ORIGIN}${EVENT_PATH}`

const pikaContents = readFileSync(pikaEnvPath, 'utf8')
const baraContents = readFileSync(baraEnvPath, 'utf8')
const brevoContents = readFileSync(brevoEnvPath, 'utf8')
const pika = parseEnvironment(pikaContents)
const bara = parseEnvironment(baraContents)
const brevo = parseEnvironment(brevoContents)
const refreshBrevo = hasArgument('--refresh-brevo')

const brevoVariableNames = [
  'BREVO_API_KEY',
  'BREVO_TEMPLATE_ID',
  'BREVO_FROM_EMAIL',
  'BREVO_FROM_NAME',
] as const
const missingBrevoVariables = brevoVariableNames.filter((name) => !brevo[name])
if (missingBrevoVariables.length > 0) {
  throw new Error(`Brevo source environment is missing: ${missingBrevoVariables.join(', ')}.`)
}
const brevoUpdates = Object.fromEntries(
  brevoVariableNames.map((name) => [
    name,
    refreshBrevo ? brevo[name] : pika[name] || brevo[name],
  ]),
) as Record<(typeof brevoVariableNames)[number], string>

const brevoCredentialResponse = await fetch('https://api.brevo.com/v3/account', {
  headers: {
    accept: 'application/json',
    'api-key': brevoUpdates.BREVO_API_KEY,
  },
})
if (!brevoCredentialResponse.ok) {
  throw new Error('Brevo source API key is not active.')
}

const baraApiOrigin = validOrigin(bara.NEXT_PUBLIC_CONVEX_SITE_URL)
if (!baraApiOrigin) {
  throw new Error('Bara NEXT_PUBLIC_CONVEX_SITE_URL must be a valid HTTPS origin.')
}

const installationRef = pika.BARA_ATTENDANCE_INSTALLATION_REF
  || bara.PIKA_INTEGRATION_REF
  || 'pika_local'
const integrationSecret = secureValue(
  pika.BARA_ATTENDANCE_INTEGRATION_SECRET,
  bara.PIKA_INTEGRATION_SECRET,
)
const eventSecret = secureValue(
  pika.BARA_ATTENDANCE_EVENT_SECRET,
  bara.PIKA_EVENT_DELIVERY_SECRET,
)
const entryTokenSecret = secureValue(pika.BARA_ATTENDANCE_ENTRY_TOKEN_SECRET)
const tenantRef = pika.BARA_ATTENDANCE_TENANT_REF || 'tenant_local'

if (new Set([integrationSecret, eventSecret, entryTokenSecret]).size !== 3) {
  throw new Error('Local integration secrets must be distinct.')
}

const nextPikaContents = upsertEnvironment(pikaContents, {
  NEXT_PUBLIC_APP_URL: PIKA_ORIGIN,
  WORKOS_MAGIC_AUTH_PILOT: 'true',
  WORKOS_COOKIE_NAME: 'pika-wos-session',
  WORKOS_COOKIE_MAX_AGE: String(AUTH_SESSION_MAX_AGE_SECONDS),
  WORKOS_MAGIC_AUTH_EMAIL_DELIVERY: 'brevo',
  WORKOS_MAGIC_AUTH_DEFAULT_EMAILS_DISABLED: 'true',
  ENABLE_MOCK_EMAIL: 'false',
  ...brevoUpdates,
  PIKA_BARA_AUTH_HANDOFF: 'false',
  PIKA_BARA_ATTENDANCE_ENABLED: 'true',
  BARA_ATTENDANCE_API_BASE_URL: baraApiOrigin,
  BARA_ATTENDANCE_INSTALLATION_REF: installationRef,
  BARA_ATTENDANCE_TENANT_REF: tenantRef,
  BARA_ATTENDANCE_INTEGRATION_SECRET: integrationSecret,
  BARA_ATTENDANCE_EVENT_SECRET: eventSecret,
  BARA_ATTENDANCE_ENTRY_TOKEN_SECRET: entryTokenSecret,
})

const nextBaraContents = upsertEnvironment(baraContents, {
  NEXT_PUBLIC_APP_URL: BARA_ORIGIN,
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: `${BARA_ORIGIN}/callback`,
  WORKOS_COOKIE_NAME: 'bara-wos-session',
  PIKA_BARA_AUTH_HANDOFF: 'false',
  PIKA_ATTENDANCE_INTEGRATION: 'true',
  PIKA_INTEGRATION_REF: installationRef,
  PIKA_INTEGRATION_SECRET: integrationSecret,
  PIKA_EVENT_DELIVERY_URL: eventDeliveryUrl,
  PIKA_EVENT_DELIVERY_SECRET: eventSecret,
})

writeFileSync(pikaEnvPath, nextPikaContents, { mode: 0o600 })
writeFileSync(baraEnvPath, nextBaraContents, { mode: 0o600 })
chmodSync(pikaEnvPath, 0o600)
chmodSync(baraEnvPath, 0o600)

process.stdout.write(`${JSON.stringify({
  ready: true,
  pikaOrigin: PIKA_ORIGIN,
  baraOrigin: BARA_ORIGIN,
  baraApiOrigin,
  eventDeliveryOrigin: new URL(eventDeliveryUrl).origin,
  installationRef,
  secretsConfigured: 3,
}, null, 2)}\n`)
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Local attendance configuration failed.'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
