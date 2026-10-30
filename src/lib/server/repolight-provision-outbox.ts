import { z } from 'zod'
import { ManagedRepoLightError } from './repolight-managed'

const claimSchema = z.object({ teacherId: z.string().uuid(), leaseToken: z.string().uuid(), attempt: z.number().int().min(1).max(3) }).strict()
const finishSchema = z.object({ acknowledged: z.boolean() }).strict()
export type RepoLightProvisionClaim = z.infer<typeof claimSchema>
type Outcome = 'ready' | 'ineligible' | 'retry' | 'failed'
export type RepoLightProvisionOutbox = {
  claim(teacherId?: string): Promise<unknown>
  finish(input: { teacherId: string; leaseToken: string; outcome: Outcome; errorCode?: string }): Promise<unknown>
}

/** One durable claim per invocation bounds egress and maintenance work. Registry
 * ensure performs current exact entitlement checks before and after egress and
 * resumes the same stored operation/key after uncertain outcomes. */
export async function deliverRepoLightProvisionOutbox(input: {
  enabled: boolean
  outbox: RepoLightProvisionOutbox
  registry: { ensure(teacherId: string): Promise<unknown> }
  teacherId?: string
}) {
  if (!input.enabled) return { status: 'disabled' as const }
  if (input.teacherId !== undefined) z.string().uuid().parse(input.teacherId)
  const raw = await input.outbox.claim(input.teacherId)
  if (raw === null) return { status: 'empty' as const }
  const row = claimSchema.parse(raw)
  if (input.teacherId && input.teacherId !== row.teacherId) throw new Error('RepoLight provisioning claim is invalid')
  let outcome: Outcome = 'ready'
  let errorCode: string | undefined
  try {
    await input.registry.ensure(row.teacherId)
  } catch (error) {
    // Never retain provider responses, tokens or exception messages in SQL.
    if (error instanceof ManagedRepoLightError) {
      outcome = error.code === 'repolight_managed_ineligible' ? 'ineligible' : error.retryable ? 'retry' : 'failed'
      errorCode = /^[a-z_]{1,64}$/.test(error.code) ? error.code : 'repolight_provision_unavailable'
    } else {
      outcome = 'retry'; errorCode = 'repolight_provision_unavailable'
    }
  }
  const result = finishSchema.parse(await input.outbox.finish({ teacherId: row.teacherId, leaseToken: row.leaseToken, outcome, ...(errorCode ? { errorCode } : {}) }))
  return { status: result.acknowledged ? outcome : 'superseded' }
}
