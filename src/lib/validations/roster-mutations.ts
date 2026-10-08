import { z } from 'zod'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const bounded = (limit: number) => z.string().refine(value => {
  const points = [...value]
  return points.length <= limit && !value.includes('\0') && points.every(point => {
    const code = point.codePointAt(0)!
    return code < 0xd800 || code > 0xdfff
  })
}, 'Invalid or oversized roster field')
const email = bounded(320).transform(value => value.trim().toLowerCase())
const nullable = (schema: ReturnType<typeof bounded>) => schema.nullable()
export const rosterActorSchema = uuid
export const rosterClassParamsSchema = z.object({ id: uuid }).strict()
export const rosterRowParamsSchema = z.object({ id: uuid, rosterId: uuid }).strict()

// Keep the original text, including offset and fractional precision. No Date round trip.
export const rosterTimestampSchema = z.string().datetime({ offset: true }).refine(value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value)
  if (!match) return false
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return year > 0 && month >= 1 && month <= 12 && day >= 1
    && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}, 'Invalid finite roster timestamp')
export const rosterStudentSchema = z.object({
  email: email.pipe(z.string().min(1)), firstName: bounded(500).pipe(z.string().min(1)),
  lastName: bounded(500).pipe(z.string().min(1)), studentNumber: nullable(bounded(128)),
  counselorEmail: email.nullable(),
}).strict()
export type RosterStudent = z.infer<typeof rosterStudentSchema>
export const rosterStudentsSchema = z.array(rosterStudentSchema).min(1).max(1000).refine(
  rows => new Set(rows.map(row => row.email)).size === rows.length, 'Duplicate roster emails')
const manualStudentSchema = z.object({
  email: bounded(320).nullable().optional(), firstName: bounded(500).nullable().optional(), lastName: bounded(500).nullable().optional(),
  studentNumber: bounded(128).nullable().optional(), counselorEmail: email.nullable().optional(),
}).strict()
export const rosterManualBodySchema = z.object({ students: z.array(manualStudentSchema).min(1).max(1000) }).strict()
  .transform(value => {
    const students: RosterStudent[] = []
    const errors: { email?: string | null; error: string }[] = []
    for (const row of value.students) {
      if (!row.email || !row.firstName || !row.lastName) {
        errors.push({ email: row.email, error: 'Missing required fields' })
      } else {
        students.push({ email: row.email.trim().toLowerCase(), firstName: row.firstName, lastName: row.lastName,
          studentNumber: row.studentNumber || null, counselorEmail: row.counselorEmail || null })
      }
    }
    return { students, errors }
  }).refine(value => value.students.length > 0, 'No valid students to add')
  .refine(value => value.students.every(row => row.email.length > 0), 'Invalid roster email')
  .refine(value => new Set(value.students.map(row => row.email)).size === value.students.length, 'Duplicate roster emails')
export const rosterCsvBodySchema = z.object({
  csvData: z.string().min(1).refine(value => new TextEncoder().encode(value).length <= 1048576 && !value.includes('\0'), 'CSV exceeds execution bound'),
  confirmed: z.boolean().optional(),
}).strict()
export const rosterCounselorBodySchema = z.object({
  counselor_email: bounded(320).nullable().transform(value => value?.trim() || null),
  expected_updated_at: rosterTimestampSchema,
}).strict()
export type RosterCounselorInput = z.infer<typeof rosterCounselorBodySchema>
export const rosterPersistedRowSchema = z.object({
  id: uuid, classroom_id: uuid, email: bounded(320).min(1), first_name: nullable(bounded(500)), last_name: nullable(bounded(500)),
  student_number: nullable(bounded(128)), counselor_email: nullable(bounded(320)), join_source: z.string(),
  created_at: rosterTimestampSchema, updated_at: rosterTimestampSchema, removed_at: z.null(),
  removed_enrolled_at: rosterTimestampSchema.nullable(), removed_enrollment_id: uuid.nullable(), removed_student_id: uuid.nullable(),
  retained_attendance_participant_active: z.boolean().nullable(), retained_manual_attendance_marks: z.unknown().refine(value => value !== undefined),
}).strict()
const bindingSchema = z.object({ roster_id: uuid, classroom_id: uuid, student_id: uuid, created_at: rosterTimestampSchema }).strict().nullable()
const valuesSchema = z.object({ firstName: nullable(bounded(500)), lastName: nullable(bounded(500)), studentNumber: nullable(bounded(128)), counselorEmail: nullable(bounded(320)) }).strict()
const evidence = { actor_id: uuid, classroom_id: uuid }
const failure = z.object({ data: z.null(), error: z.object({ code: z.string(), message: z.string().nullable().optional(), details: z.string().nullable().optional(), hint: z.string().nullable().optional() }).strict(),
  count: z.number().nullable().optional(), status: z.number().int().optional(), statusText: z.string().optional() }).strict()
const metadata = { count: z.number().nullable().optional(), status: z.number().int().optional(), statusText: z.string().optional() }
export const rosterUpsertEnvelopeSchema = z.union([
  z.object({ data: z.union([
    z.object({ ...evidence, mode: z.enum(['manual', 'csv-preview', 'csv-confirmed']), needs_confirmation: z.literal(false),
      rows: z.array(z.object({ roster: rosterPersistedRowSchema, binding: bindingSchema }).strict()).min(1).max(1000) }).strict(),
    z.object({ ...evidence, mode: z.literal('csv-preview'), needs_confirmation: z.literal(true),
      changes: z.array(z.object({ email: bounded(320).min(1), current: valuesSchema, incoming: valuesSchema }).strict()).min(1).max(1000),
      update_count: z.number().int().min(1).max(1000), new_count: z.number().int().min(0).max(1000), total_count: z.number().int().min(1).max(1000) }).strict(),
  ]), error: z.null(), ...metadata }).strict(), failure,
])
export const rosterPatchEnvelopeSchema = z.union([
  z.object({ data: z.object({ ...evidence, roster: rosterPersistedRowSchema, binding: bindingSchema }).strict(), error: z.null(), ...metadata }).strict(), failure,
])
