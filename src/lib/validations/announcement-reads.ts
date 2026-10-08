import { z } from 'zod'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
const fraction = /(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})$/

/** Preserve PostgreSQL sub-millisecond precision while comparing equivalent UTC instants. */
export function compareAnnouncementReadTimestamps(left: string, right: string): number {
  const leftMillis = Date.parse(left)
  const rightMillis = Date.parse(right)
  // Zod may run an object refinement after a field refinement has failed.
  if (!Number.isFinite(leftMillis) || !Number.isFinite(rightMillis)) return Number.NaN
  const leftFraction = fraction.exec(left)?.[1] ?? ''
  const rightFraction = fraction.exec(right)?.[1] ?? ''
  const width = Math.max(leftFraction.length, rightFraction.length)
  const scale = BigInt(10) ** BigInt(width)
  const instant = (millis: number, digits: string) => BigInt(Math.floor(millis / 1000)) * scale
    + BigInt(digits.padEnd(width, '0') || '0')
  const leftInstant = instant(leftMillis, leftFraction)
  const rightInstant = instant(rightMillis, rightFraction)
  return leftInstant === rightInstant ? 0 : leftInstant > rightInstant ? 1 : -1
}

export const announcementReadQuerySchema = z.object({ classroomId: uuid }).strict()
const classroomSchema = z.object({ id: uuid, teacher_id: uuid, archived_at: timestamp.nullable() })
const enrollmentSchema = z.object({ classroom_id: uuid, student_id: uuid })
export const announcementReadClassroomEnvelopeSchema = z.object({ data: classroomSchema.nullable(), error: z.null() })
export const announcementReadEnrollmentEnvelopeSchema = z.object({ data: enrollmentSchema.nullable(), error: z.null() })
export const announcementReadMembershipSchema = z.array(enrollmentSchema).length(1)

export const announcementReadRowSchema = z.object({
  id: uuid, classroom_id: uuid, title: z.string().nullable(), content: z.string(),
  created_by: uuid, is_draft: z.boolean(), published_at: timestamp.nullable(),
  scheduled_for: timestamp.nullable(), created_at: timestamp, updated_at: timestamp,
}).superRefine((row, context) => {
  const valid = row.is_draft
    ? row.published_at === null && row.scheduled_for === null
    : row.published_at !== null && (row.scheduled_for === null
      || compareAnnouncementReadTimestamps(row.published_at, row.scheduled_for) === 0)
  if (!valid) context.addIssue({ code: 'custom', message: 'Invalid announcement publication state' })
})

const rootSchema = classroomSchema.extend({ announcements: z.array(announcementReadRowSchema).max(1000) })
export const announcementReadOwnerEnvelopeSchema = z.object({ data: rootSchema.nullable(), error: z.null() })
export const announcementReadMemberEnvelopeSchema = z.object({
  data: rootSchema.extend({ membership: announcementReadMembershipSchema }).nullable(), error: z.null(),
})
