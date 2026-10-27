import { cache } from 'react'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { memoizeAdmissionRequestRead } from '@/lib/server/admission-request-context'

const registryDecisionSchema = z.object({
  version: z.literal(2),
  registry_revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  bootstrap_manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  actor_id: z.string().uuid(),
  admitted: z.boolean(),
  bootstrap_member: z.boolean(),
}).strict().refine((decision) => !decision.bootstrap_member || decision.admitted)

export type ClassroomAdmissionRegistryDecision = z.infer<typeof registryDecisionSchema>

type AdmissionReadRpc = (
  name: 'read_classroom_experience_admission_v2',
  args: { p_actor_id: string },
) => PromiseLike<{ data: unknown; error: unknown }>

function unavailable(): ApiError {
  return new ApiError(503, 'Classroom experience admission configuration is unavailable')
}

async function readRegistry(actorId: string, manifest: string): Promise<ClassroomAdmissionRegistryDecision> {
  try {
    // Keep the wire boundary narrow; generated JSON metadata cannot validate
    // authorization fields. Validate every field before using the decision.
    const client = getServiceRoleClient({
      fetch: (input, init) => fetch(input, {
        ...init,
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      }),
    })
    const rpc = (client.rpc as unknown as AdmissionReadRpc).bind(client)
    const result = await rpc('read_classroom_experience_admission_v2', { p_actor_id: actorId })
    if (result.error) throw unavailable()
    const parsed = registryDecisionSchema.safeParse(result.data)
    if (!parsed.success || parsed.data.actor_id !== actorId
      || parsed.data.bootstrap_manifest_sha256 !== manifest) throw unavailable()
    return parsed.data
  } catch {
    // Neither a transport failure nor an unknown contract may become a legacy
    // fallback, an empty success, or a diagnostic containing registry contents.
    throw unavailable()
  }
}

// React 18 exposes cache in the RSC runtime, but not in ordinary Node jobs.
// Outside RSC, the API context above supplies memoization; bare jobs read afresh.
const readInReactRequest = typeof cache === 'function' ? cache(readRegistry) : readRegistry

export function readClassroomAdmissionRegistry(
  actorId: string,
  manifest: string,
): Promise<ClassroomAdmissionRegistryDecision> {
  return memoizeAdmissionRequestRead(`${manifest}:${actorId}`, () => readInReactRequest(actorId, manifest))
}
