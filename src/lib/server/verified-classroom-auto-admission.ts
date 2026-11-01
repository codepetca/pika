import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'
import { logServerError } from '@/lib/server/diagnostics'
import { classroomExperienceRegistryBootstrapManifest } from '@/lib/server/classroom-experience-admission'

const resultSchema = z.object({
  version: z.literal(1),
  outcome: z.enum(['admitted', 'already_admitted', 'growth_stopped', 'excluded', 'unverified']),
  registry_revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
}).strict()

type Result = z.infer<typeof resultSchema>
type EnsureRpc = (name: 'ensure_verified_classroom_admission_v1', args: { p_actor_id: string, p_bootstrap_manifest_sha256: string }) => PromiseLike<{ data: unknown, error: unknown }>

/** This switch adds a caller-side gate; the registry has its own independent policy. */
export function isVerifiedClassroomAutoAdmissionEnabled(): boolean {
  return process.env.PIKA_CLASSROOM_VERIFIED_AUTO_ADMISSION_ENABLED === 'true'
}

/** Restrict writes to the same active Home and strictly parsed v2 registry source. */
function activeRegistryManifest(): string | null {
  if (!isVerifiedClassroomAutoAdmissionEnabled() || process.env.PIKA_CLASSROOM_HOME_ACCESS_ENABLED !== 'true') return null
  return classroomExperienceRegistryBootstrapManifest()
}

/** Bound even an adapter which fails to honour its AbortSignal. */
async function bounded<T>(request: PromiseLike<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Classroom admission unavailable')), 5_000) }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

/** The caller supplies a trusted server-resolved actor, never a client-provided identity. */
export async function ensureVerifiedClassroomAdmission(actorId: string): Promise<Result | null> {
  const manifest = activeRegistryManifest()
  if (!manifest) return null
  const client = getServiceRoleClient({
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(5_000) }),
  })
  const rpc = (client.rpc as unknown as EnsureRpc).bind(client)
  const { data, error } = await bounded(rpc('ensure_verified_classroom_admission_v1', { p_actor_id: actorId, p_bootstrap_manifest_sha256: manifest }))
  if (error) throw new Error('Classroom admission unavailable')
  const parsed = resultSchema.safeParse(data)
  if (!parsed.success) throw new Error('Classroom admission unavailable')
  return parsed.data
}

/** Admission is independent of authentication; an outage must not break sign-in. */
export async function tryEnsureVerifiedClassroomAdmission(actorId: string): Promise<void> {
  try {
    await ensureVerifiedClassroomAdmission(actorId)
  } catch {
    // Content-free diagnostic: no database error or user identity is passed through.
    try { logServerError('auth.session') } catch { /* Authentication must still succeed. */ }
    // The registry remains authoritative and fails closed for classroom access.
    // A signed-in user can explicitly retry through the admission endpoint.
  }
}

const eligibilitySchema = z.object({ version: z.literal(1), eligible: z.boolean() }).strict()
type EligibilityRpc = (name: 'read_verified_classroom_auto_admission_eligibility_v1', args: { p_actor_id: string, p_bootstrap_manifest_sha256: string }) => PromiseLike<{ data: unknown, error: unknown }>

/** Read-only advisory check. The admission writer independently rechecks eligibility. */
export async function canRequestVerifiedClassroomAdmission(actorId: string): Promise<boolean> {
  const manifest = activeRegistryManifest()
  if (!manifest) return false
  const client = getServiceRoleClient({
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(5_000) }),
  })
  const rpc = (client.rpc as unknown as EligibilityRpc).bind(client)
  const { data, error } = await bounded(rpc('read_verified_classroom_auto_admission_eligibility_v1', { p_actor_id: actorId, p_bootstrap_manifest_sha256: manifest }))
  if (error) throw new Error('Classroom admission unavailable')
  const parsed = eligibilitySchema.safeParse(data)
  if (!parsed.success) throw new Error('Classroom admission unavailable')
  return parsed.data.eligible
}
