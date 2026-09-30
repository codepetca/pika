import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { CourseBlueprintAuthoringContext } from '@/lib/course-blueprint-authoring-context'

const TTL_MS = 30 * 60 * 1000
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export type ClassroomDraftGuidanceProvenance = CourseBlueprintAuthoringContext & {
  content_version_id?: string
  source_blueprint_version_id: string
  source_blueprint_version_number: number
  source_draft_revision: number
}

const tokenSchema = z.object({
  version: z.literal(1),
  teacher_id: z.string().min(1).max(128),
  classroom_id: z.string().min(1).max(128),
  draft_id: z.string().uuid(),
  content_version_id: z.string().min(1).max(128).optional(),
  source_blueprint_version_id: z.string().min(1).max(128),
  source_blueprint_version_number: z.number().int().positive(),
  source_draft_revision: z.number().int().positive(),
  target: z.enum(['assignments', 'tests']),
  unit_exception_id: z.string().nullable(),
  context_sha256: sha256Schema,
  seed_content_sha256: sha256Schema,
  trial: z.boolean(),
  issued_at_ms: z.number().int().nonnegative(),
  expires_at_ms: z.number().int().positive(),
}).strict()

function secret(): string {
  const value = process.env.SESSION_SECRET
  if (!value || value.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters')
  return value
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function hashClassroomDraftContent(content: string): string {
  return hash(content)
}

function sign(encoded: string): Buffer {
  return createHmac('sha256', secret()).update(encoded).digest()
}

/** Binds a teacher-editable preview to the exact frozen guidance that generated its seed. */
export function createClassroomDraftProvenanceToken(args: {
  teacherId: string
  classroomId: string
  draftId: string
  provenance: ClassroomDraftGuidanceProvenance
  seedContentSha256: string
  trial?: boolean
  nowMs?: number
}): string {
  const nowMs = args.nowMs ?? Date.now()
  const encoded = Buffer.from(JSON.stringify(tokenSchema.parse({
    version: 1,
    teacher_id: args.teacherId,
    classroom_id: args.classroomId,
    draft_id: args.draftId,
    content_version_id: args.provenance.content_version_id,
    source_blueprint_version_id: args.provenance.source_blueprint_version_id,
    source_blueprint_version_number: args.provenance.source_blueprint_version_number,
    source_draft_revision: args.provenance.source_draft_revision,
    target: args.provenance.target,
    unit_exception_id: args.provenance.unit_exception_id,
    context_sha256: hash(args.provenance),
    seed_content_sha256: args.seedContentSha256,
    trial: args.trial ?? false,
    issued_at_ms: nowMs,
    expires_at_ms: nowMs + TTL_MS,
  }))).toString('base64url')
  return `${encoded}.${sign(encoded).toString('base64url')}`
}

export function verifyClassroomDraftProvenanceToken(args: {
  token: string
  teacherId: string
  classroomId: string
  draftId: string
  provenance: ClassroomDraftGuidanceProvenance
  seedContentSha256: string
  nowMs?: number
}): boolean {
  if (!args.token || args.token.length > 4096) return false
  const [encoded, signature, ...extra] = args.token.split('.')
  if (!encoded || !signature || extra.length) return false
  try {
    const supplied = Buffer.from(signature, 'base64url')
    const expected = sign(encoded)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false
    const parsed = tokenSchema.safeParse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')))
    if (!parsed.success) return false
    const payload = parsed.data
    const nowMs = args.nowMs ?? Date.now()
    const provenanceToHash = { ...args.provenance }
    if (!payload.content_version_id) delete provenanceToHash.content_version_id
    return payload.issued_at_ms <= nowMs
      && payload.expires_at_ms >= nowMs
      && !payload.trial
      && payload.teacher_id === args.teacherId
      && payload.classroom_id === args.classroomId
      && payload.draft_id === args.draftId
      && (payload.content_version_id ?? payload.source_blueprint_version_id)
        === (args.provenance.content_version_id ?? args.provenance.source_blueprint_version_id)
      && payload.source_blueprint_version_id === args.provenance.source_blueprint_version_id
      && payload.source_blueprint_version_number === args.provenance.source_blueprint_version_number
      && payload.source_draft_revision === args.provenance.source_draft_revision
      && payload.target === args.provenance.target
      && payload.unit_exception_id === args.provenance.unit_exception_id
      && payload.context_sha256 === hash(provenanceToHash)
      && payload.seed_content_sha256 === args.seedContentSha256
  } catch {
    return false
  }
}
