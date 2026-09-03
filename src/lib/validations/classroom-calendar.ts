import { z } from 'zod'
import { SEMESTER_RANGES } from '@/lib/calendar'

// Only identity is read before relationship authorization on the body-addressed
// legacy URL. Other fields remain unknown until the operation schema is parsed.
export const calendarClassroomIdentitySchema = z.object({ classroom_id: z.string() })

const customCalendarSchema = z.object({ start_date: z.iso.date(), end_date: z.iso.date() })
const semesterCalendarSchema = z.object({
  semester: z.enum(['semester1', 'semester2']),
  year: z.number().int().min(1900).max(9998),
}).transform(({ semester, year }) => ({
  start_date: `${year}-${SEMESTER_RANGES[semester].start}`,
  end_date: `${semester === 'semester1' ? year + 1 : year}-${SEMESTER_RANGES[semester].end}`,
}))

// Match the existing valid-input precedence: a complete semester wins over a
// custom range. Unknown actor/plan/date-array fields are never forwarded.
export const createClassroomCalendarSchema = z.union([semesterCalendarSchema, customCalendarSchema])
  .superRefine(({ start_date, end_date }, ctx) => {
    const days = (Date.parse(`${end_date}T12:00:00Z`) - Date.parse(`${start_date}T12:00:00Z`)) / 86_400_000
    if (days <= 0 || days > 366) ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'Calendar must end after its start and span at most 366 days' })
  })

export const setClassroomCalendarDaySchema = z.object({ date: z.iso.date(), is_class_day: z.boolean() })
export type CreateClassroomCalendarInput = z.infer<typeof createClassroomCalendarSchema>
export type SetClassroomCalendarDayInput = z.infer<typeof setClassroomCalendarDaySchema>

export const classroomCalendarRowsSchema = z.array(z.object({
  id: z.string().uuid(), classroom_id: z.string().uuid(), date: z.iso.date(),
  is_class_day: z.boolean(), prompt_text: z.string().nullable(),
})).max(367)
