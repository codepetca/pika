import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { z } from 'zod'

const entryPayloadSchema = z.object({
  v: z.literal(2),
  i: z.string().uuid(),
  r: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/),
  o: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/),
  c: z.string().regex(/^[A-Za-z0-9._~-]{20,128}$/),
  e: z.number().int().safe().positive(),
}).strict()

const ENTRY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{80,768}$/
const ATTENDANCE_REF_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/
const IV_BYTES = 12
const TAG_BYTES = 16

export interface AttendanceEntryPayload {
  classroomId: string
  rosterRef: string
  occurrenceRef: string
  checkInToken: string
  expiresAt: string
}

export class AttendanceEntryTokenError extends Error {
  constructor(readonly code: 'not_configured' | 'invalid' | 'expired') {
    super(code)
    this.name = 'AttendanceEntryTokenError'
  }
}

function secretKey(secret = process.env.BARA_ATTENDANCE_ENTRY_TOKEN_SECRET): Buffer {
  if (!secret || secret.length < 32) {
    throw new AttendanceEntryTokenError('not_configured')
  }
  return createHash('sha256').update(secret, 'utf8').digest()
}

export function deriveStudentAttendanceOccurrenceBinding(input: {
  studentId: string
  occurrenceRef: string
  secret?: string
}): string {
  if (
    !z.string().uuid().safeParse(input.studentId).success
    || !ATTENDANCE_REF_PATTERN.test(input.occurrenceRef)
  ) {
    throw new AttendanceEntryTokenError('invalid')
  }
  return createHmac('sha256', secretKey(input.secret))
    .update('pika-student-attendance-occurrence-v1\0', 'utf8')
    .update(input.studentId, 'utf8')
    .update('\0', 'utf8')
    .update(input.occurrenceRef, 'utf8')
    .digest('base64url')
    .slice(0, 32)
}

export function sealAttendanceEntryToken(
  payload: AttendanceEntryPayload,
  options: { secret?: string; iv?: Buffer } = {},
): string {
  const expiresAt = Date.parse(payload.expiresAt)
  const parsed = entryPayloadSchema.safeParse({
    v: 2,
    i: payload.classroomId,
    r: payload.rosterRef,
    o: payload.occurrenceRef,
    c: payload.checkInToken,
    e: expiresAt,
  })
  if (!parsed.success) throw new AttendanceEntryTokenError('invalid')

  const iv = options.iv ?? randomBytes(IV_BYTES)
  if (iv.length !== IV_BYTES) throw new AttendanceEntryTokenError('invalid')
  const cipher = createCipheriv('aes-256-gcm', secretKey(options.secret), iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(parsed.data), 'utf8'),
    cipher.final(),
  ])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

export function openAttendanceEntryToken(
  token: string,
  options: { secret?: string; now?: number } = {},
): AttendanceEntryPayload {
  if (!ENTRY_TOKEN_PATTERN.test(token)) throw new AttendanceEntryTokenError('invalid')
  try {
    const sealed = Buffer.from(token, 'base64url')
    if (sealed.toString('base64url') !== token) throw new Error('non-canonical token')
    if (sealed.length <= IV_BYTES + TAG_BYTES) throw new Error('short token')
    const iv = sealed.subarray(0, IV_BYTES)
    const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
    const ciphertext = sealed.subarray(IV_BYTES + TAG_BYTES)
    const decipher = createDecipheriv('aes-256-gcm', secretKey(options.secret), iv)
    decipher.setAuthTag(tag)
    const decoded = JSON.parse(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
    ) as unknown
    const parsed = entryPayloadSchema.parse(decoded)
    if (parsed.e <= (options.now ?? Date.now())) {
      throw new AttendanceEntryTokenError('expired')
    }
    return {
      classroomId: parsed.i,
      rosterRef: parsed.r,
      occurrenceRef: parsed.o,
      checkInToken: parsed.c,
      expiresAt: new Date(parsed.e).toISOString(),
    }
  } catch (error) {
    if (error instanceof AttendanceEntryTokenError) throw error
    throw new AttendanceEntryTokenError('invalid')
  }
}
