import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { CourseBlueprintDraftGuidanceProvenance } from '@/lib/course-blueprint-authoring-context'

const TTL_MS = 30 * 60 * 1000
const payloadSchema = z.object({
  version: z.literal(1),
  teacher_id: z.string().min(1).max(128),
  blueprint_id: z.string().min(1).max(128),
  target: z.enum(['assignments', 'tests']),
  blueprint_revision: z.number().int().positive(),
  unit_exception_id: z.string().nullable(),
  context_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  generated_content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  trial: z.boolean(),
  issued_at_ms: z.number().int().nonnegative(),
  expires_at_ms: z.number().int().positive(),
}).strict()

function secret(): string {
  const value = process.env.SESSION_SECRET
  if (!value || value.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters')
  return value
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function hashCourseBlueprintDraftContent(content: string): string {
  return sha256(content)
}

function sign(encoded: string): Buffer {
  return createHmac('sha256', secret()).update(encoded).digest()
}

export function createCourseBlueprintDraftProvenanceToken(args: {
  teacherId: string
  blueprintId: string
  provenance: CourseBlueprintDraftGuidanceProvenance
  generatedContentSha256: string
  trial: boolean
  nowMs?: number
}): string {
  const nowMs = args.nowMs ?? Date.now()
  const payload = payloadSchema.parse({
    version: 1,
    teacher_id: args.teacherId,
    blueprint_id: args.blueprintId,
    target: args.provenance.target,
    blueprint_revision: args.provenance.blueprint_revision,
    unit_exception_id: args.provenance.unit_exception_id,
    context_sha256: sha256(args.provenance),
    generated_content_sha256: args.generatedContentSha256,
    trial: args.trial,
    issued_at_ms: nowMs,
    expires_at_ms: nowMs + TTL_MS,
  })
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${sign(encoded).toString('base64url')}`
}

export function verifyCourseBlueprintDraftProvenanceToken(args: {
  token: string
  teacherId: string
  blueprintId: string
  provenance: CourseBlueprintDraftGuidanceProvenance
  generatedContentSha256: string
  nowMs?: number
}): boolean {
  if (!args.token || args.token.length > 4096) return false
  const [encoded, signature, ...extra] = args.token.split('.')
  if (!encoded || !signature || extra.length) return false
  try {
    const supplied = Buffer.from(signature, 'base64url')
    const expected = sign(encoded)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false
    const parsed = payloadSchema.safeParse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')))
    if (!parsed.success) return false
    const payload = parsed.data
    const nowMs = args.nowMs ?? Date.now()
    return payload.issued_at_ms <= nowMs
      && payload.expires_at_ms >= nowMs
      && !payload.trial
      && payload.teacher_id === args.teacherId
      && payload.blueprint_id === args.blueprintId
      && payload.target === args.provenance.target
      && payload.blueprint_revision === args.provenance.blueprint_revision
      && payload.unit_exception_id === args.provenance.unit_exception_id
      && payload.context_sha256 === sha256(args.provenance)
      && payload.generated_content_sha256 === args.generatedContentSha256
  } catch {
    return false
  }
}
