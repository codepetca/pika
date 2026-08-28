import { z } from 'zod'

export const teacherAttendanceViewQuerySchema = z.object({
  classroom_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (use YYYY-MM-DD)'),
}).strict()

const attendanceCommandBaseSchema = z.object({
  classroom_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (use YYYY-MM-DD)'),
  request_id: z.string().uuid(),
})

export const teacherAttendanceSessionCommandSchema = attendanceCommandBaseSchema.extend({
  command: z.enum(['open', 'close']),
}).strict()

export const teacherAttendanceMarksSchema = attendanceCommandBaseSchema.extend({
  marks: z.array(z.object({
    student_id: z.string().uuid(),
    status: z.enum(['automatic', 'present', 'late', 'absent']),
    reason_code: z.enum([
      'staff_correction',
      'late_arrival',
      'excused_absence',
      'administrative_override',
    ]).optional(),
  }).strict()).min(1).max(200),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>()
  value.marks.forEach((mark, index) => {
    if (seen.has(mark.student_id)) {
      context.addIssue({
        code: 'custom',
        path: ['marks', index, 'student_id'],
        message: 'Each student may be marked once per request',
      })
    }
    seen.add(mark.student_id)
  })
})

export const teacherAttendanceCheckInInvalidationSchema = attendanceCommandBaseSchema.extend({
  student_ids: z.array(z.string().uuid()).min(1).max(200),
}).strict().superRefine((value, context) => {
  if (new Set(value.student_ids).size !== value.student_ids.length) {
    context.addIssue({
      code: 'custom', path: ['student_ids'], message: 'Each student may be reset once per request',
    })
  }
})

export const teacherAttendanceSyncSchema = z.object({
  classroom_id: z.string().uuid(),
  window_start: z.string().date(),
  window_end: z.string().date(),
}).strict().superRefine((value, context) => {
  const start = Date.parse(`${value.window_start}T00:00:00.000Z`)
  const end = Date.parse(`${value.window_end}T00:00:00.000Z`)
  if (end < start) {
    context.addIssue({ code: 'custom', path: ['window_end'], message: 'Window is reversed' })
  } else if ((end - start) / 86_400_000 > 400) {
    context.addIssue({ code: 'custom', path: ['window_end'], message: 'Window is too large' })
  }
})
