import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'
import { classroomExperienceRegistryBootstrapManifest } from '@/lib/server/classroom-experience-admission'
import { scheduleClassroomLaunchAlert } from '@/lib/server/classroom-launch-alerts'

const resultSchema = z.object({
  version: z.literal(1),
  outcome: z.enum(['admitted', 'already_admitted', 'growth_stopped', 'excluded', 'unverified']),
  registry_revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
}).strict()

type Result = z.infer<typeof resultSchema>
type AdmissionRpcName = 'ensure_verified_classroom_admission_v1' | 'read_verified_classroom_auto_admission_eligibility_v1'
type AdmissionRpc = (name: AdmissionRpcName, args: { p_actor_id: string, p_bootstrap_manifest_sha256: string }) => PromiseLike<{ data: unknown, error: unknown }>

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

async function queryAdmission<T>(name: AdmissionRpcName, actorId: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const manifest = activeRegistryManifest()
    if (!manifest) return null
    const client = getServiceRoleClient({
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(5_000) }),
    })
    const rpc = (client.rpc as unknown as AdmissionRpc).bind(client)
    const { data, error } = await bounded(rpc(name, { p_actor_id: actorId, p_bootstrap_manifest_sha256: manifest }))
    if (error) throw new Error('Classroom admission unavailable')
    const parsed = schema.safeParse(data)
    if (!parsed.success) throw new Error('Classroom admission unavailable')
    return parsed.data
  } catch (error) {
    scheduleClassroomLaunchAlert('admission')
    throw error
  }
}

/** The caller supplies a trusted server-resolved actor, never a client-provided identity. */
export function ensureVerifiedClassroomAdmission(actorId: string): Promise<Result | null> {
  return queryAdmission('ensure_verified_classroom_admission_v1', actorId, resultSchema)
}

/** Admission is independent of authentication; an outage must not break sign-in. */
export async function tryEnsureVerifiedClassroomAdmission(actorId: string): Promise<void> {
  try {
    await ensureVerifiedClassroomAdmission(actorId)
  } catch {
    // The registry remains authoritative and fails closed for classroom access.
    // A signed-in user can explicitly retry through the admission endpoint.
  }
}

const eligibilitySchema = z.object({ version: z.literal(1), eligible: z.boolean() }).strict()

/** Read-only advisory check. The admission writer independently rechecks eligibility. */
export async function canRequestVerifiedClassroomAdmission(actorId: string): Promise<boolean> {
  return (await queryAdmission('read_verified_classroom_auto_admission_eligibility_v1', actorId, eligibilitySchema))?.eligible ?? false
}
