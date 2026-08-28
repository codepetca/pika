import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { CourseGuideImportDraft } from '@/lib/course-guide-import'

const TOKEN_TTL_MS = 30 * 60 * 1000

const payloadSchema = z.object({
  v: z.literal(1),
  teacher_id: z.string().min(1).max(128),
  classroom_id: z.string().min(1).max(128),
  citation_markdown: z.string().min(1).max(2600),
  issued_at_ms: z.number().int().nonnegative(),
  expires_at_ms: z.number().int().positive(),
}).strict()

export type CourseGuideImportProvenance = {
  citationMarkdown: string
}

function signingSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters')
  }
  return secret
}

function signature(encodedPayload: string): Buffer {
  return createHmac('sha256', signingSecret()).update(encodedPayload).digest()
}

export function createCourseGuideImportProvenanceToken(args: {
  teacherId: string
  classroomId: string
  draft: CourseGuideImportDraft
  nowMs?: number
}): string {
  const nowMs = args.nowMs ?? Date.now()
  const payload = payloadSchema.parse({
    v: 1,
    teacher_id: args.teacherId,
    classroom_id: args.classroomId,
    citation_markdown: args.draft.citationMarkdown,
    issued_at_ms: nowMs,
    expires_at_ms: nowMs + TOKEN_TTL_MS,
  })
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encodedPayload}.${signature(encodedPayload).toString('base64url')}`
}

export function verifyCourseGuideImportProvenanceToken(args: {
  token: string
  teacherId: string
  classroomId: string
  nowMs?: number
}): CourseGuideImportProvenance | null {
  if (!args.token || args.token.length > 4096) return null
  const [encodedPayload, encodedSignature, ...extra] = args.token.split('.')
  if (!encodedPayload || !encodedSignature || extra.length > 0) return null

  try {
    const supplied = Buffer.from(encodedSignature, 'base64url')
    const expected = signature(encodedPayload)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null
    const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    const parsed = payloadSchema.safeParse(decoded)
    if (!parsed.success) return null
    const nowMs = args.nowMs ?? Date.now()
    if (
      parsed.data.issued_at_ms > nowMs
      || parsed.data.expires_at_ms < nowMs
      || parsed.data.teacher_id !== args.teacherId
      || parsed.data.classroom_id !== args.classroomId
    ) return null
    return {
      citationMarkdown: parsed.data.citation_markdown,
    }
  } catch {
    return null
  }
}
