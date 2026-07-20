import { z } from 'zod'

const entryDateSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  'Invalid date format (use YYYY-MM-DD)',
)

export const teacherStudentHistoryQuerySchema = z.object({
  classroom_id: z.string().trim().min(1, 'classroom_id is required'),
  student_id: z.string().trim().min(1, 'student_id is required'),
  before_date: entryDateSchema.optional(),
  date: entryDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
}).refine(
  value => !(value.before_date && value.date),
  { message: 'before_date and date cannot be used together' },
)
